/** The vulnerability classes `swarm-security-hunt` accepts (client-safe). */
export const SECURITY_AUDIT_CLASSES = [
  "Injection",
  "Access Control",
  "Resource and File Handling",
  "Cryptography and Secrets",
  "Business Logic",
  "Data Exposure",
  "Chained Vulnerabilities and Trust Boundaries",
  "Wildcard",
  "Obvious Things",
] as const;

/** What each class is about — shown when the live Concept can't be read or lacks a description. */
export const SECURITY_AUDIT_CLASS_FALLBACK: Record<(typeof SECURITY_AUDIT_CLASSES)[number], string> = {
  Injection: "Untrusted input reaches an interpreter (database, shell, template, browser, or LLM) as instructions.",
  "Access Control": "A caller does or reads something they should not be allowed to; builds on Broken Access Control.",
  "Resource and File Handling": "Untrusted input picks which file, host, object, or memory a component touches.",
  "Cryptography and Secrets":
    "Weak or misused cryptography, bad randomness, and secrets stored, shipped, or exposed wrongly.",
  "Business Logic": "The code does what it says but product rules can be broken by order, timing, numbers, or trust.",
  "Data Exposure": "Data leaves through a side channel, secondary feature, or bulk path rather than the main read.",
  "Chained Vulnerabilities and Trust Boundaries":
    "Several small gaps combine, or one component trusts what another never promised.",
  Wildcard: "Odd, unfinished, or undocumented code and API use the UI never makes.",
  "Obvious Things": "A literal checklist of common, easy-to-spot security mistakes, run on every repository.",
};

export interface SecurityAuditClassInfo {
  name: string;
  description: string;
  /** Plain-text excerpt of the class's "What to hunt" section; empty when unknown. */
  hunt: string;
  /** The description is the built-in text, not the live Concept's. */
  fallback: boolean;
}

/** The built-in classes, for when the live ones can't be read. */
export function fallbackSecurityAuditClasses(): SecurityAuditClassInfo[] {
  return SECURITY_AUDIT_CLASSES.map((name) => ({
    name,
    description: SECURITY_AUDIT_CLASS_FALLBACK[name],
    hunt: "",
    fallback: true,
  }));
}
