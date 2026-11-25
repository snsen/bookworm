#!/usr/bin/env node
// End-to-end checks against the production build.
//   npm run build && npm run fixtures && node tests/e2e/run.mjs [--browser chromium|firefox] [--headed]
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { arg, fixture, requireFixtures, sleep, startPreview } from './helpers.mjs';

requireFixtures();
const browserName = arg('browser', 'chromium');
const browserType = { chromium, firefox }[browserName];
if (!browserType) throw new Error(`Unknown browser ${browserName}`);

const server = await startPreview();
const browser = await browserType.launch({ headless: !process.argv.includes('--headed') });
const results = [];

async function newPage(settings) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  if (settings) {
    await context.addInitScript((s) => localStorage.setItem('bookworm.settings.v1', JSON.stringify(s)), settings);
  }
  const page = await context.newPage();
  page.problems = [];
  page.on('pageerror', (e) => page.problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !text.includes('BookError')) page.problems.push(`console.error: ${text}`);
    if (/Content.Security.Policy/i.test(text)) page.problems.push(`CSP: ${text}`);
  });
  await page.goto(server.url);
  return page;
}

const state = (page) => page.evaluate(() => window.__bookworm.state());
const settled = (page) =>
  page.waitForFunction(() => {
    const s = window.__bookworm.state();
    return s && !s.animating && s.visibleReady;
  }, null, { timeout: 30_000 });

async function open(page, name) {
  const started = Date.now();
  await page.setInputFiles('[data-testid=file-input]', fixture(name));
  await page.waitForFunction(() => window.__bookworm.state()?.visibleReady, null, { timeout: 120_000 });
  return Date.now() - started;
}

async function test(name, fn) {
  const started = Date.now();
  let page;
  try {
    page = await fn((p) => (page = p));
    if (page?.problems?.length) throw new Error(page.problems.join('\n'));
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n    ${String(err?.stack ?? err).split('\n').slice(0, 6).join('\n    ')}`);
  } finally {
    await page?.context().close();
  }
}

console.log(`E2E on ${browserName} ${browser.version()} — ${server.url}`);

await test('welcome screen renders without errors', async (keep) => {
  const page = keep(await newPage());
  assert.equal(await page.isVisible('.welcome'), true);
  assert.match(await page.textContent('.welcome h1'), /Kitap Kurdu/);
  return page;
});

await test('654-page PDF opens quickly and turns with keys', async (keep) => {
  const page = keep(await newPage());
  const ms = await open(page, 'pride-a5.pdf');
  let s = await state(page);
  assert.equal(s.pageCount, 654);
  assert.ok(ms < 8000, `opened in ${ms} ms`);
  assert.deepEqual(s.visible, [0], 'cover is shown alone');
  await page.keyboard.press('ArrowRight');
  await settled(page);
  assert.deepEqual((await state(page)).visible, [1, 2]);
  await page.keyboard.press('End');
  await settled(page);
  assert.ok((await state(page)).visible.includes(653));
  await page.keyboard.press('Home');
  await settled(page);
  s = await state(page);
  assert.deepEqual(s.visible, [0]);
  return page;
});

await test('render window stays bounded while turning 60 spreads', async (keep) => {
  const page = keep(await newPage());
  await open(page, 'pride-a5.pdf');
  // Turns are queued while one is animating (max 2 waiting), so wait for each to finish.
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => !window.__bookworm.state().animating);
  }
  await settled(page);
  const s = await state(page);
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  assert.ok(s.current > 100, `at page ${s.current}`);
  assert.ok(s.cache.rendered <= 16, `rendered pages ${s.cache.rendered}`);
  assert.ok(canvases <= 16, `canvases ${canvases}`);
  // Pages that fly by are either never rendered (aborted) or rendered and evicted.
  assert.ok(s.cache.evictions > 0, `evictions ${s.cache.evictions}`);
  assert.ok(s.cache.renders < 200, `renders ${s.cache.renders}`);
  return page;
});

await test('mouse: click pages, click stage, drag corner', async (keep) => {
  const page = keep(await newPage());
  await open(page, 'pride.epub');
  const box = await page.locator('.flipbook').boundingBox();
  const midY = box.y + box.height / 2;
  await page.mouse.click(box.x + box.width * 0.8, midY);
  await settled(page);
  assert.deepEqual((await state(page)).visible, [1, 2], 'click right page');
  await page.mouse.click(box.x + box.width * 0.8, midY);
  await settled(page);
  await page.mouse.click(box.x + box.width * 0.2, midY);
  await settled(page);
  assert.deepEqual((await state(page)).visible, [1, 2], 'click left page');
  await page.mouse.click(1900, 540);
  await settled(page);
  assert.deepEqual((await state(page)).visible, [3, 4], 'click empty stage (right)');
  // Drag the bottom-right corner across to the left.
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width - 5 - (i * box.width) / 20, box.y + box.height - 40);
  await page.mouse.up();
  await settled(page);
  assert.deepEqual((await state(page)).visible, [5, 6], 'corner drag');
  return page;
});

await test('EPUB: text size re-paginates and keeps the position', async (keep) => {
  const page = keep(await newPage());
  await open(page, 'pride.epub');
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  await settled(page);
  const before = await state(page);
  await page.click('.settings-btn');
  await page.click('label:has-text("Büyük")');
  await page.waitForFunction((n) => {
    const s = window.__bookworm.state();
    return s && s.pageCount !== n && s.visibleReady;
  }, before.pageCount, { timeout: 60_000 });
  const after = await state(page);
  assert.ok(after.pageCount > before.pageCount, `${before.pageCount} → ${after.pageCount}`);
  const ratio = (p) => p.current / p.pageCount;
  assert.ok(Math.abs(ratio(after) - ratio(before)) < 0.02, 'relative position kept');
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('.settings'), true);
  return page;
});

await test('EPUB with many SVG illustrations', async (keep) => {
  const page = keep(await newPage());
  const ms = await open(page, 'alice.epub');
  const s = await state(page);
  assert.ok(s.pageCount > 100, `${s.pageCount} pages`);
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  await settled(page);
  const imgs = await page.evaluate(() =>
    [...document.querySelectorAll('.epub-host')].flatMap((h) => [...h.shadowRoot.querySelectorAll('img')]).filter(
      (i) => i.complete && i.naturalWidth > 0,
    ).length,
  );
  assert.ok(imgs > 0, 'illustrations are loaded');
  console.log(`    (opened in ${ms} ms, ${s.pageCount} pages)`);
  return page;
});

await test('night tone re-renders PDF pages and dims the stage', async (keep) => {
  const page = keep(await newPage());
  await open(page, 'pride-a5.pdf');
  const before = (await state(page)).cache.renders;
  await page.click('.settings-btn');
  await page.click('label:has-text("Gece")');
  await page.waitForFunction((n) => window.__bookworm.state().cache.renders > n, before);
  await settled(page);
  const paper = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim());
  assert.equal(paper, '#1b1916');
  // Sample the middle of the right page: should now be dark.
  const dark = await page.evaluate(() => {
    const c = document.querySelectorAll('canvas')[0];
    const d = c.getContext('2d').getImageData(5, 5, 1, 1).data;
    return d[0] + d[1] + d[2];
  });
  assert.ok(dark < 150, `paper pixel sum ${dark}`);
  const dim = await page.evaluate(() => getComputedStyle(document.querySelector('.dim')).opacity);
  assert.equal(Number(dim).toFixed(2), '0.25');
  return page;
});

await test('autoplay turns pages, pauses, and loops at the end', async (keep) => {
  const page = keep(await newPage({ interval: 3, loop: true }));
  await open(page, 'pride-a5.pdf');
  await page.keyboard.press(' ');
  assert.equal((await state(page)).playing, true);
  // Turns start at 3 s and 6 s; the second one finishes animating about a second later.
  await sleep(7_600);
  assert.deepEqual((await state(page)).visible, [3, 4], 'two automatic turns');
  await page.keyboard.press(' ');
  assert.equal((await state(page)).playing, false);
  await sleep(3_500);
  assert.deepEqual((await state(page)).visible, [3, 4], 'paused');
  await page.keyboard.press('End');
  await settled(page);
  await page.keyboard.press(' ');
  await sleep(3_600);
  await settled(page);
  assert.deepEqual((await state(page)).visible, [0], 'looped to the start');
  return page;
});

await test('autoplay stops at the end when looping is off', async (keep) => {
  const page = keep(await newPage({ interval: 3, loop: false }));
  await open(page, 'pride-a5.pdf');
  await page.keyboard.press('End');
  await settled(page);
  await page.keyboard.press(' ');
  await sleep(3_600);
  const s = await state(page);
  assert.equal(s.playing, false);
  assert.ok(s.visible.includes(653));
  return page;
});

await test('full screen hides the controls when idle', async (keep) => {
  const page = keep(await newPage());
  await open(page, 'pride-a5.pdf');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.fullscreenElement !== null, null, { timeout: 5000 });
  await page.mouse.move(500, 500);
  await sleep(3_600);
  assert.equal(await page.evaluate(() => document.body.classList.contains('ui-idle')), true, 'idle after 3 s');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.toolbar')).opacity), '0');
  await page.mouse.move(600, 600);
  assert.equal(await page.evaluate(() => document.body.classList.contains('ui-idle')), false, 'wakes on move');
  return page;
});

await test('DRM, Kindle and unsupported files show clear errors', async (keep) => {
  const page = keep(await newPage());
  const cases = [
    ['drm-adobe.epub', /DRM/],
    ['fake-kindle.azw3', /Kindle/],
  ];
  for (const [file, re] of cases) {
    await page.setInputFiles('[data-testid=file-input]', fixture(file));
    await page.waitForSelector('dialog[open]');
    assert.match(await page.textContent('dialog[open] .error-message'), re);
    await page.click('dialog[open] button');
  }
  await page.setInputFiles('[data-testid=file-input]', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await page.waitForSelector('dialog[open]');
  assert.match(await page.textContent('dialog[open] .error-message'), /PDF ve EPUB/);
  return page;
});

await test('settings persist across reloads', async (keep) => {
  const page = keep(await newPage());
  await open(page, 'pride-a5.pdf');
  await page.click('.settings-btn');
  await page.click('label:has-text("Beyaz")');
  await page.locator('.settings input[type=range]').first().fill('42');
  await page.reload();
  const s = await page.evaluate(() => window.__bookworm.settings());
  assert.equal(s.tone, 'white');
  assert.equal(s.interval, 42);
  return page;
});

await browser.close();
await server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed on ${browserName}`);
process.exit(failed.length ? 1 : 0);
