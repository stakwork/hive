/**
 * The addresses artifacts carry. An agent wrote them, so none is trusted:
 * an address reaches a frame or a link only after one of these has passed
 * it. (An `<img>`, `<video>` or `<audio>` source needs no such check —
 * nothing it loads can run.)
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/;

const pageOrigin = (): string | undefined => (typeof window === "undefined" ? undefined : window.location.origin);

/**
 * An address made whole, or null when it is not a web page: a bare host
 * gets a scheme, a path is on Hive's own origin, and nothing but http(s)
 * passes — a `javascript:` address must never reach a frame or a link.
 */
export function webAddress(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  const typed = hasScheme || text.startsWith("/") ? text : `${LOCAL_HOST.test(text) ? "http" : "https"}://${text}`;
  try {
    const url = new URL(typed, pageOrigin());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * A PDF's address, when it may be put in a frame. The browser's PDF viewer
 * does not run in a sandboxed frame, so an unsandboxed one is only ever
 * given what cannot turn out to be someone else's page: an address on
 * Hive's own origin, or bytes this page already holds.
 */
export function framablePdfAddress(input: string): string | null {
  const text = input.trim();
  const origin = pageOrigin();
  if (!origin) return null;
  if (text.startsWith(`blob:${origin}/`) || /^data:application\/pdf[;,]/i.test(text)) return text;
  const whole = webAddress(text);
  return whole && new URL(whole).origin === origin ? whole : null;
}

/** The host and the rest of an address, for showing one without its scheme. */
export function addressParts(address: string): { host: string; rest: string } {
  const whole = webAddress(address);
  if (!whole) return { host: address, rest: "" };
  const url = new URL(whole);
  const rest = `${url.pathname}${url.search}${url.hash}`;
  return { host: url.host, rest: rest === "/" ? "" : rest };
}
