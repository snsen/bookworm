export type Format = 'pdf' | 'epub' | 'kindle' | 'acsm' | 'lcpl' | 'unknown';

const ascii = (bytes: Uint8Array, start: number, len: number) =>
  String.fromCharCode(...bytes.subarray(start, start + len));

/**
 * Decides what a file is from its first bytes (at least 1 KiB) and its name.
 * Content wins over the extension, except for Kindle/Adobe formats that are only
 * recognisable by name in some variants.
 */
export function sniffFormat(name: string, head: Uint8Array): Format {
  const ext = name.toLowerCase().match(/\.([a-z0-9-]+)$/)?.[1] ?? '';

  // PDF: "%PDF-" must appear within the first 1024 bytes.
  if (ascii(head, 0, Math.min(head.length, 1024)).includes('%PDF-')) return 'pdf';

  // Mobipocket/AZW/AZW3: PalmDB header with type+creator at offset 60.
  const palm = head.length >= 68 ? ascii(head, 60, 8) : '';
  if (palm === 'BOOKMOBI' || palm === 'TEXtREAd') return 'kindle';
  // KFX container
  if (ascii(head, 0, 4) === 'CONT' || ascii(head, 0, 8) === 'êDRMIONî') return 'kindle';
  if (['azw', 'azw1', 'azw3', 'azw4', 'kfx', 'kfx-zip', 'mobi', 'prc', 'tpz'].includes(ext)) return 'kindle';

  // ZIP-based: EPUB has a "mimetype" entry first containing application/epub+zip.
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    if (ascii(head, 30, 60).includes('application/epub+zip') || ext === 'epub') return 'epub';
    return 'unknown';
  }

  if (ext === 'acsm' || ascii(head, 0, 300).includes('<fulfillmentToken')) return 'acsm';
  if (ext === 'lcpl') return 'lcpl';
  return 'unknown';
}

/** Minimal view of a ZIP archive (JSZip satisfies it). */
export interface ZipLike {
  file(path: string): { async(type: 'string'): Promise<string> } | null;
}

// Algorithms that only obfuscate embedded fonts. Books using them are not DRM-protected.
const FONT_OBFUSCATION = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC']);

/**
 * Returns a short name of the DRM scheme protecting the EPUB, or null if none.
 */
export async function findEpubDrm(zip: ZipLike): Promise<string | null> {
  if (zip.file('META-INF/rights.xml')) return 'Adobe ADEPT';
  if (zip.file('META-INF/sinf.xml')) return 'Apple FairPlay';
  if (zip.file('META-INF/license.lcpl')) return 'Readium LCP';

  const enc = zip.file('META-INF/encryption.xml');
  if (!enc) return null;
  const xml = await enc.async('string');
  const algorithms = [...xml.matchAll(/EncryptionMethod[^>]*Algorithm\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const real = algorithms.filter((a) => !FONT_OBFUSCATION.has(a));
  return real.length > 0 ? 'encrypted content' : null;
}
