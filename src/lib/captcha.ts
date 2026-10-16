/**
 * Captcha sites: the hostnames a workspace's admins allow a strut job to ask
 * a person to solve a captcha on. A site matches an entry when its hostname
 * equals it or is a subdomain of it.
 */

export const MAX_CAPTCHA_SITES = 50;

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** The lowercase hostname of a URL or host (scheme, credentials, port, path, query stripped); null when it is not a valid hostname. */
export function normalizeSite(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/, 1)[0];
  s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/:\d*$/, "");
  s = s.replace(/\.$/, "");
  return HOSTNAME.test(s) ? s : null;
}

/** Normalized, deduped entries, at most `MAX_CAPTCHA_SITES`; entries that are not hostnames are dropped. */
export function normalizeSites(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    const site = normalizeSite(entry);
    if (site && !out.includes(site)) out.push(site);
    if (out.length >= MAX_CAPTCHA_SITES) break;
  }
  return out;
}

/** Whether the page's site is one of the allowed entries, or a subdomain of one. */
export function siteAllowed(site: unknown, list: readonly string[] | null | undefined): boolean {
  const host = normalizeSite(site);
  if (!host || !list) return false;
  return list.some((entry) => {
    const allowed = normalizeSite(entry);
    return !!allowed && (host === allowed || host.endsWith(`.${allowed}`));
  });
}
