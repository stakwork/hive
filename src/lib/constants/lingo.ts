export const LINGO_TYPES = [
  "person",
  "product_term",
  "industry_term",
  "company_jargon",
  "system_page",
  "code_symbol",
  "acronym",
] as const;

export type LingoType = typeof LINGO_TYPES[number];
