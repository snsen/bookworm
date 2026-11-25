import { preview } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixture = (name) => join(root, 'fixtures', name);

export function requireFixtures() {
  const missing = ['pride-a5.pdf', 'pride.epub', 'alice.epub', 'drm-adobe.epub', 'fake-kindle.azw3', 'photo.pdf'].filter(
    (f) => !existsSync(fixture(f)),
  );
  if (missing.length) {
    console.error(`Missing fixtures: ${missing.join(', ')}\nRun "npm run fixtures" first.`);
    process.exit(2);
  }
}

/** Serves ./dist with `vite preview` on a free port. */
export async function startPreview() {
  if (!existsSync(join(root, 'dist', 'index.html'))) {
    console.error('dist/ not found. Run "npm run build" first.');
    process.exit(2);
  }
  const server = await preview({ root, preview: { port: 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'warn' });
  const url = server.resolvedUrls?.local?.[0];
  return { url, close: () => server.close() };
}

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
