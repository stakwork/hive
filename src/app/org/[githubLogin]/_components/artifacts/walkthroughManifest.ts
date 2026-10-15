/**
 * A walkthrough's manifest (`walkthrough.json`, strut `browser/walkthrough`,
 * strut plans/live-artifacts.md §4) read for the viewer. Pure, and tolerant
 * of a recording still being written: it is rewritten after every frame.
 */

export interface WalkthroughFrame {
  /** Strut's link to the frame — a sibling of the manifest — read through the reader route. */
  key: string;
  caption: string;
  pageUrl?: string;
  /** Set on the frame where the recording stopped: why. */
  failed?: string;
}

export interface WalkthroughManifest {
  title?: string;
  /** "recording" | "done" | "stopped" — passed through. */
  status?: string;
  frames: WalkthroughFrame[];
  failed: string[];
}

const str = (v: unknown, max = 2_000): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

/** A frame's file: a name in the manifest's own directory, never a path. */
const FILE = /^[\w.-]+\.(png|jpe?g|webp)$/i;

/**
 * The manifest at `key` (strut's link, `/jobs/<job>/files/…/walkthrough.json`)
 * → its frames, each a sibling of the manifest. A frame whose file is not a
 * plain image name in that directory is dropped. Null when it is not a manifest.
 */
export function parseWalkthroughManifest(raw: unknown, key: string): WalkthroughManifest | null {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { frames?: unknown }).frames)) return null;
  const m = raw as Record<string, unknown>;
  const dir = key.slice(0, key.lastIndexOf("/") + 1);
  const frames: WalkthroughFrame[] = [];
  for (const f of m.frames as unknown[]) {
    if (typeof f !== "object" || f === null) continue;
    const r = f as Record<string, unknown>;
    const file = str(r.file, 200);
    if (!file || !FILE.test(file)) continue;
    const pageUrl = str(r.pageUrl);
    const failed = str(r.failed);
    frames.push({ key: `${dir}${file}`, caption: str(r.caption, 500) ?? "", ...(pageUrl ? { pageUrl } : {}), ...(failed ? { failed } : {}) });
  }
  const title = str(m.title, 500);
  const status = str(m.status, 64);
  const failed = Array.isArray(m.failed) ? m.failed.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
  return { ...(title ? { title } : {}), ...(status ? { status } : {}), frames, failed };
}
