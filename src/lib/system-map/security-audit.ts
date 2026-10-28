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
