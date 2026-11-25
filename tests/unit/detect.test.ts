import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { findEpubDrm, sniffFormat } from '../../src/sources/detect';

const bytes = (s: string, size = 1024) => {
  const b = new Uint8Array(size);
  b.set(new TextEncoder().encode(s));
  return b;
};

describe('sniffFormat', () => {
  it('detects PDF by signature regardless of extension', () => {
    expect(sniffFormat('book.bin', bytes('%PDF-1.7\n'))).toBe('pdf');
  });

  it('detects EPUB from the mimetype entry', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    const data = await zip.generateAsync({ type: 'uint8array' });
    expect(sniffFormat('noext', data.subarray(0, 1024))).toBe('epub');
  });

  it('detects Kindle files by header and by extension', () => {
    const mobi = new Uint8Array(1024);
    mobi.set(new TextEncoder().encode('BOOKMOBI'), 60);
    expect(sniffFormat('x.bin', mobi)).toBe('kindle');
    expect(sniffFormat('Book.AZW3', new Uint8Array(1024))).toBe('kindle');
    expect(sniffFormat('book.kfx', bytes('CONT'))).toBe('kindle');
  });

  it('recognises Adobe .acsm tokens', () => {
    expect(sniffFormat('URLLink.acsm', bytes('<?xml version="1.0"?><fulfillmentToken'))).toBe('acsm');
  });

  it('rejects other files', () => {
    expect(sniffFormat('notes.txt', bytes('hello'))).toBe('unknown');
    expect(sniffFormat('archive.zip', bytes('PK\u0003\u0004'))).toBe('unknown');
  });
});

describe('findEpubDrm', () => {
  const encryption = (alg: string) =>
    `<encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/></enc:EncryptedData></encryption>`;

  it('returns null for a plain EPUB', async () => {
    const zip = new JSZip();
    zip.file('META-INF/container.xml', '<container/>');
    expect(await findEpubDrm(zip)).toBeNull();
  });

  it('ignores font obfuscation', async () => {
    const zip = new JSZip();
    zip.file('META-INF/encryption.xml', encryption('http://www.idpf.org/2008/embedding'));
    expect(await findEpubDrm(zip)).toBeNull();
  });

  it('flags encrypted content, Adobe, Apple and LCP', async () => {
    const enc = new JSZip();
    enc.file('META-INF/encryption.xml', encryption('http://www.w3.org/2001/04/xmlenc#aes128-cbc'));
    expect(await findEpubDrm(enc)).not.toBeNull();
    for (const [file, name] of [
      ['META-INF/rights.xml', 'Adobe ADEPT'],
      ['META-INF/sinf.xml', 'Apple FairPlay'],
      ['META-INF/license.lcpl', 'Readium LCP'],
    ]) {
      const z = new JSZip();
      z.file(file, '<x/>');
      expect(await findEpubDrm(z)).toBe(name);
    }
  });
});
