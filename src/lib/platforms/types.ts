/**
 * Platform registry types.
 *
 * A `Platform` is the canonical record for one "kind" of service that can
 * be pinned to a workspace canvas as a `service` node. The `id` is the
 * stable integration key — it becomes `service.customData.kind` on the
 * canvas node, and a future "click a Vercel service to see deploys" or
 * "click a Postgres service to see slow queries" flow dispatches off
 * exactly this field.
 *
 * IDs are kebab-case, immutable once shipped. Renaming an existing id
 * would orphan every service node in the wild that references it. Adding
 * new platforms is free. Removing or renaming is a migration.
 *
 * The icon paths come from simple-icons (24x24 filled silhouettes), so
 * the canvas renders them with `mode: 'fill'` + `viewBox: 24` via the
 * library's `kind: 'icon'` slot. Brand colors are reserved for v2 — when
 * we add a brand-tinted left-edge stripe or a per-platform accent, this
 * is where it'll live. Today `brandColor` is informational; the canvas
 * still draws every service card in the cyan service-accent.
 *
 * The forward-looking integration adapters (`logsAdapter`, `metricsAdapter`,
 * etc.) are intentionally not declared yet — when they ship, they hang
 * off this same record so a service node never needs to know more than
 * its `kind` to dispatch into the right integration.
 */
export interface Platform {
  /**
   * Stable kebab-case id. Becomes `service.customData.kind`. Never rename
   * — that would orphan every existing service node that references this
   * value as a string discriminator.
   */
  id: string;
  /** Display name shown in the picker grid and (eventually) integration UIs. */
  label: string;
  /**
   * Alternate spellings and search hints. Matched alongside `label` by
   * the picker's search input — case-insensitive substring. Useful for
   * "ec2" → finds "AWS EC2", or "next" → finds "Vercel".
   */
  aliases?: string[];
  /**
   * SVG path data strings in simple-icons' 24x24 coordinate space. Most
   * brands are a single path; a few (PostgreSQL's stacked elephant logo)
   * may have multiple subpaths in one string. The renderer paints these
   * as `fill={brandColor ?? node.resolvedStroke}` via the IconSlot's
   * `mode: 'fill'`.
   */
  paths: string[];
  /**
   * Official brand color. Reserved for v2 (per-platform accent stripe /
   * tinted card body). Today the canvas uses the generic service-cyan
   * for every card regardless. Stored here so adding the accent later
   * is a single render-site change, not a data migration.
   */
  brandColor?: string;
}
