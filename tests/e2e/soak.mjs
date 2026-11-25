#!/usr/bin/env node
// Long-running autoplay test: checks that memory stays flat while pages keep turning.
//   node tests/e2e/soak.mjs [--file pride-a5.pdf] [--minutes 60] [--interval 3] [--sample 60] [--out soak.csv]
// Chromium only (uses the DevTools protocol to force GC and read heap/DOM counters).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { arg, fixture, requireFixtures, sleep, startPreview } from './helpers.mjs';

requireFixtures();
const file = arg('file', 'pride-a5.pdf');
const minutes = Number(arg('minutes', '60'));
const interval = Number(arg('interval', '3'));
const sampleSec = Number(arg('sample', '60'));
const out = arg('out', '');
const warmupSec = Math.min(120, (minutes * 60) / 4);

const server = await startPreview();
// A persistent profile gives the browser a unique command line, so its process tree can be found.
const profile = mkdtempSync(join(tmpdir(), 'bookworm-soak-'));
const context = await chromium.launchPersistentContext(profile, { viewport: { width: 1920, height: 1080 } });
await context.addInitScript(
  (s) => localStorage.setItem('bookworm.settings.v1', JSON.stringify(s)),
  { interval, loop: true, sound: false },
);
const page = context.pages()[0] ?? (await context.newPage());
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

/** RSS of the whole browser process tree, in MB (renderer + GPU + browser). */
function treeRssMb() {
  try {
    const lines = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,args='], { encoding: 'utf8', maxBuffer: 1 << 24 })
      .trim()
      .split('\n');
    const rows = lines.map((l) => l.trim().split(/\s+/).slice(0, 3).map(Number));
    const rootLine = lines.find((l) => l.includes(`--user-data-dir=${profile}`) && !l.includes('--type='));
    const rootPid = rootLine ? Number(rootLine.trim().split(/\s+/)[0]) : null;
    if (!rootPid) return NaN;
    const children = new Map();
    for (const [pid, ppid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
    let total = 0;
    const stack = [rootPid];
    while (stack.length) {
      const p = stack.pop();
      total += rss.get(p) ?? 0;
      stack.push(...(children.get(p) ?? []));
    }
    return total / 1024;
  } catch {
    return NaN;
  }
}

async function sample(t) {
  await cdp.send('HeapProfiler.collectGarbage');
  await sleep(300);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const app = await page.evaluate(() => {
    const s = window.__bookworm.state();
    const canvases = [...document.querySelectorAll('canvas')];
    return {
      page: s.current,
      flips: s.flips,
      rendered: s.cache.rendered,
      renders: s.cache.renders,
      canvases: canvases.length,
      canvasMb: canvases.reduce((a, c) => a + c.width * c.height * 4, 0) / 1048576,
      epubPages: document.querySelectorAll('.epub-page').length,
    };
  });
  return {
    t: Math.round(t),
    heapMb: +(m.JSHeapUsedSize / 1048576).toFixed(1),
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
    documents: m.Documents,
    rssMb: +treeRssMb().toFixed(0),
    ...app,
    canvasMb: +app.canvasMb.toFixed(1),
  };
}

await page.goto(server.url);
await page.setInputFiles('[data-testid=file-input]', fixture(file));
await page.waitForFunction(() => window.__bookworm.state()?.visibleReady, null, { timeout: 120_000 });
await page.keyboard.press(' ');
const t0 = Date.now();
const elapsed = () => (Date.now() - t0) / 1000;
console.log(`Soak: ${file}, ${minutes} min, every ${interval} s (≈${Math.round((minutes * 60) / interval)} turns)`);

const rows = [];
let warm = null;
const log = (r, tag = '') =>
  console.log(
    `${String(r.t).padStart(5)}s page ${String(r.page).padStart(4)} flips ${String(r.flips).padStart(5)} | heap ${r.heapMb} MB | nodes ${r.nodes} | listeners ${r.listeners} | docs ${r.documents} | canvases ${r.canvases} (${r.canvasMb} MB) | rendered ${r.rendered} | rss ${r.rssMb} MB ${tag}`,
  );

let next = warmupSec;
while (elapsed() < minutes * 60) {
  await sleep(Math.max(0, (next - elapsed()) * 1000));
  const r = await sample(elapsed());
  rows.push(r);
  if (!warm) {
    warm = r;
    log(r, '(baseline after warm-up)');
  } else log(r);
  next += sampleSec;
}

const last = rows.at(-1);
const settledRss = rows[Math.floor(rows.length / 4)].rssMb;
const peak = (k) => Math.max(...rows.map((r) => r[k]));
const playing = await page.evaluate(() => window.__bookworm.state().playing);
await context.close();
await server.close();
rmSync(profile, { recursive: true, force: true });

if (out) {
  const keys = Object.keys(rows[0]);
  writeFileSync(out, [keys.join(','), ...rows.map((r) => keys.map((k) => r[k]).join(','))].join('\n') + '\n');
}

const checks = [
  ['still playing', playing],
  ['pages kept turning', last.flips >= Math.floor((minutes * 60) / interval) * 0.85],
  ['JS heap growth < 15 MB', last.heapMb - warm.heapMb < 15],
  ['DOM nodes growth < 20%', last.nodes < warm.nodes * 1.2 + 200],
  ['event listeners growth < 20%', last.listeners < warm.listeners * 1.2 + 50],
  ['rendered pages bounded (≤ 16)', peak('rendered') <= 16],
  // Browser image/font caches fill up during the first minutes; judge RSS from a quarter in.
  ['process RSS growth after first quarter < 150 MB', !(last.rssMb - settledRss >= 150)],
  ['no page errors', problems.length === 0],
];
console.log('\nSummary (baseline → end, peak):');
console.log(`  heap ${warm.heapMb} → ${last.heapMb} MB (peak ${peak('heapMb')})`);
console.log(`  nodes ${warm.nodes} → ${last.nodes} (peak ${peak('nodes')})`);
console.log(`  rss ${warm.rssMb} → ${last.rssMb} MB (after first quarter ${settledRss}, peak ${peak('rssMb')})`);
console.log(`  flips ${last.flips}, renders ${last.renders}`);
for (const [name, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
if (problems.length) console.log(problems.slice(0, 10).join('\n'));
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
