/**
 * Pinned sanitize schema for source documents.
 *
 * Pinned rather than derived from `defaultSchema` so an upstream change cannot
 * silently widen what we accept — this is arbitrary third-party markup arriving
 * through an unauthenticated webhook.
 *
 * `img` is dropped as a beacon channel; `svg`/`math` because foreign content is
 * the classic mXSS vector. `rehype-raw` must never enter this pipeline — it
 * re-parses raw HTML after sanitization and would undo it. Regex tag-stripping
 * is not an acceptable substitute (bypassable via malformed tags).
 */

import type { Schema } from "hast-util-sanitize";

export const RUN_REPORT_SANITIZE_SCHEMA: Schema = {
  // Strip everything not named here.
  tagNames: [
    // block
    "p", "div", "section", "article", "header", "footer", "main", "aside",
    "blockquote", "pre", "hr", "br",
    // headings
    "h1", "h2", "h3", "h4", "h5", "h6",
    // inline
    "span", "a", "strong", "b", "em", "i", "u", "s", "sub", "sup", "code",
    "mark", "small", "abbr", "cite", "q", "time",
    // lists
    "ul", "ol", "li", "dl", "dt", "dd",
    // tables
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    "colgroup", "col",
  ],

  attributes: {
    a: ["href", "title"],
    th: ["colSpan", "rowSpan", "align", "scope"],
    td: ["colSpan", "rowSpan", "align"],
    col: ["span"],
    colgroup: ["span"],
    time: ["dateTime"],
    abbr: ["title"],
    q: ["cite"],
    blockquote: ["cite"],
    ol: ["start", "reversed"],
    // No global allowlist: `class`, `style`, `id`, `target`, `srcset` and every
    // `on*` handler are absent by omission and cannot be re-added per-tag.
    "*": [],
  },

  // http(s) only — blocks `javascript:`, `data:`, `vbscript:`, `file:`.
  protocols: {
    href: ["http", "https", "mailto"],
    cite: ["http", "https"],
  },

  // Force a safe rel on every anchor that survives.
  required: {
    a: { rel: "noopener noreferrer" },
  },

  // Only text and elements survive; comments/doctypes/raw are dropped.
  clobber: [],
  clobberPrefix: "",
  strip: ["script", "style", "iframe", "object", "embed", "svg", "math"],
  allowComments: false,
  allowDoctypes: false,
};

/**
 * Keys are hast PROPERTY names (`colSpan`), values the HTML attribute names we
 * emit (`colspan`). Conflating the two silently drops the attribute.
 */
export const PROJECTED_ATTRIBUTES: Record<string, Readonly<Record<string, string>>> = {
  a: { href: "href", title: "title", rel: "rel" },
  th: { colSpan: "colspan", rowSpan: "rowspan", align: "align", scope: "scope" },
  td: { colSpan: "colspan", rowSpan: "rowspan", align: "align" },
  col: { span: "span" },
  colgroup: { span: "span" },
  time: { dateTime: "datetime" },
  abbr: { title: "title" },
  q: { cite: "cite" },
  blockquote: { cite: "cite" },
  ol: { start: "start", reversed: "reversed" },
};
