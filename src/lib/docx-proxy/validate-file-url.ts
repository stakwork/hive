/**
 * SSRF protection for the DOCX proxy route.
 *
 * Validates a raw URL string against the operator-configured hostname
 * allowlist. Throws a descriptive Error on rejection so callers can map
 * it to an appropriate HTTP status code.
 */
export function validateFileUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }

  // Protocol must be https — reject http, file, data, ftp, etc.
  if (url.protocol !== "https:") {
    throw new Error("Forbidden protocol");
  }

  // Hostname must be in the operator-configured allowlist.
  const allowed = (process.env.DOCX_PROXY_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  if (!allowed.includes(url.hostname)) {
    throw new Error("Hostname not allowlisted");
  }

  return url;
}
