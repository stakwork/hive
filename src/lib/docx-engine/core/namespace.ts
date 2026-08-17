/**
 * OOXML namespace prefix constants used throughout the engine.
 */

export const NS = {
  w: "w:",
  r: "r:",
  a: "a:",
  p: "p:",
  v: "v:",
  wp: "wp:",
  wpc: "wpc:",
  mc: "mc:",
  o: "o:",
  m: "m:",
  wps: "wps:",
  wpg: "wpg:",
  ct: "ct:",
  dc: "dc:",
  dcterms: "dcterms:",
  cp: "cp:",
  relationships: "Relationships",
  relationship: "Relationship",
} as const;

/** Relationship type URIs */
export const REL_TYPES = {
  STYLES:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
  NUMBERING:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
  COMMENTS:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments",
  HYPERLINK:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
  IMAGE:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  THEME:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  FONT_TABLE:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable",
  SETTINGS:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
  WEB_SETTINGS:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings",
  OFFICE_DOCUMENT:
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
} as const;
