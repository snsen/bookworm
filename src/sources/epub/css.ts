// Book stylesheets are rewritten so they work inside a page's shadow root:
//   html/body/:root selectors → .epub-html/.epub-body (there is no <html>/<body> in a shadow tree)
//   [epub|type…] → [data-epub-type…] (works for both XHTML- and HTML-parsed content)
//   vh/vw → px of the logical page (otherwise pagination would depend on the window size)
//   url(...) → blob URLs from the archive
//   @font-face → hoisted to the document (fonts declared inside shadow trees are ignored)

const SEL_BOUNDARY_BEFORE = '(^|[\\s>+~,(])';
const SEL_BOUNDARY_AFTER = '(?=$|[\\s>+~,.:#\\[)])';
const HTML_RE = new RegExp(`${SEL_BOUNDARY_BEFORE}html${SEL_BOUNDARY_AFTER}`, 'gi');
const BODY_RE = new RegExp(`${SEL_BOUNDARY_BEFORE}body${SEL_BOUNDARY_AFTER}`, 'gi');

export function rewriteSelector(selector: string): string {
  return selector
    .replace(HTML_RE, '$1.epub-html')
    .replace(BODY_RE, '$1.epub-body')
    .replace(/:root\b/g, '.epub-html');
}

const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Relative url(...) references in a stylesheet (data:/blob:/absolute ones are skipped). */
export function collectCssUrls(css: string): string[] {
  const out = new Set<string>();
  for (const m of css.matchAll(URL_RE)) {
    const u = m[2].trim();
    if (!/^(data:|blob:|[a-z][a-z0-9+.-]*:\/\/|#)/i.test(u)) out.add(u);
  }
  return [...out];
}

export interface PreprocessOptions {
  /** Map of url(...) value → replacement; unmapped relative URLs are dropped. */
  urls: Map<string, string>;
  /** Logical page size in px used for vw/vh units. */
  viewportWidth: number;
  viewportHeight: number;
}

export function preprocessCss(css: string, opts: PreprocessOptions): string {
  return (
    css
      // @import is not allowed in constructable stylesheets; imports are inlined by the caller.
      .replace(/@import\s+[^;]+;/gi, '')
      .replace(/@namespace\s+[^;]+;/gi, '')
      .replace(/\[\s*epub\s*\|\s*type/gi, '[data-epub-type')
      .replace(URL_RE, (whole, _q, raw: string) => {
        const u = raw.trim();
        if (/^(data:|blob:|#)/i.test(u)) return whole;
        const mapped = opts.urls.get(u);
        return mapped ? `url("${mapped}")` : 'none';
      })
      // Only rewrite numbers directly followed by the unit (not identifiers like "vhs").
      .replace(/(-?\d*\.?\d+)(vh|vw|vmin|vmax|dvh|svh|lvh)\b/gi, (_w, n: string, unit: string) => {
        const u = unit.toLowerCase();
        const { viewportWidth: w, viewportHeight: h } = opts;
        const base = u === 'vw' ? w : u === 'vmin' ? Math.min(w, h) : u === 'vmax' ? Math.max(w, h) : h;
        return `${((parseFloat(n) * base) / 100).toFixed(2)}px`;
      })
  );
}

/** Extracts @import targets so the caller can inline them. */
export function collectImports(css: string): string[] {
  return [...css.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?[^;]*;/gi)].map((m) => m[1]);
}

/**
 * Builds a constructable stylesheet with rewritten selectors.
 * Returns the @font-face rules separately (they must live at document level).
 */
export function buildScopedSheet(cssText: string): { sheet: CSSStyleSheet; fontFaces: string[] } {
  const sheet = new CSSStyleSheet();
  const fontFaces: string[] = [];
  try {
    sheet.replaceSync(cssText);
  } catch {
    return { sheet, fontFaces };
  }
  walkRules(sheet, fontFaces);
  return { sheet, fontFaces };
}

function walkRules(container: CSSStyleSheet | CSSGroupingRule, fontFaces: string[]): void {
  const rules = container.cssRules;
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (rule instanceof CSSStyleRule) {
      const next = rewriteSelector(rule.selectorText);
      if (next !== rule.selectorText) rule.selectorText = next;
      // Nested CSS: style rules can contain child rules.
      if ('cssRules' in rule && (rule as CSSStyleRule & { cssRules?: CSSRuleList }).cssRules?.length) {
        walkRules(rule as unknown as CSSGroupingRule, fontFaces);
      }
    } else if (rule instanceof CSSFontFaceRule) {
      fontFaces.push(rule.cssText);
      container.deleteRule(i);
    } else if (rule instanceof CSSPageRule) {
      container.deleteRule(i);
    } else if ('cssRules' in rule) {
      walkRules(rule as CSSGroupingRule, fontFaces);
    }
  }
}
