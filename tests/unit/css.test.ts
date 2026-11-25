import { describe, expect, it } from 'vitest';
import { collectCssUrls, collectImports, preprocessCss, rewriteSelector } from '../../src/sources/epub/css';

describe('rewriteSelector', () => {
  it('maps html/body/:root to the shadow-tree wrappers', () => {
    expect(rewriteSelector('body')).toBe('.epub-body');
    expect(rewriteSelector('html body > p, :root')).toBe('.epub-html .epub-body > p, .epub-html');
    expect(rewriteSelector('body.calibre p')).toBe('.epub-body.calibre p');
    expect(rewriteSelector('section:not(body)')).toBe('section:not(.epub-body)');
  });

  it('leaves look-alike names alone', () => {
    expect(rewriteSelector('.body-text, #html, .tbody, tbody td')).toBe('.body-text, #html, .tbody, tbody td');
  });
});

describe('preprocessCss', () => {
  const opts = { urls: new Map([['../fonts/a.woff2', 'blob:font']]), viewportWidth: 400, viewportHeight: 600 };

  it('rewrites archive URLs and drops everything else', () => {
    const out = preprocessCss(
      '@font-face{src:url("../fonts/a.woff2")} p{background:url(http://tracker.example/x.png)} q{background:url(data:image/png;base64,AA)}',
      opts,
    );
    expect(out).toContain('url("blob:font")');
    expect(out).not.toContain('tracker.example');
    expect(out).toContain('data:image/png;base64,AA');
  });

  it('converts viewport units to the logical page size', () => {
    expect(preprocessCss('img{height:100vh;width:50vw}', opts)).toBe('img{height:600.00px;width:200.00px}');
  });

  it('removes @import/@namespace and normalises epub|type', () => {
    const out = preprocessCss('@import "x.css"; @namespace epub "http://www.idpf.org/2007/ops"; [epub|type~="z3998:poem"]{}', opts);
    expect(out.trim()).toBe('[data-epub-type~="z3998:poem"]{}');
  });

  it('collects relative URLs and imports', () => {
    expect(collectCssUrls('a{b:url(x.png)} c{d:url("data:x")} e{f:url(https://a/b)}')).toEqual(['x.png']);
    expect(collectImports('@import url("a.css"); @import \'b.css\' screen;')).toEqual(['a.css', 'b.css']);
  });
});
