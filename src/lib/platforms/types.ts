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
   * SVG path data strings. Coordinate space is determined by `viewBox`
   * (defaults to 24, matching simple-icons). Most brands are a single
   * path; a few (PostgreSQL's stacked elephant logo) have multiple
   * subpaths split across separate strings. The renderer paints these
   * via the IconSlot — see `renderMode` for fill-vs-stroke.
   */
  paths: string[];
  /**
   * How the icon should be painted. `'fill'` (default) is right for
   * brand silhouettes — simple-icons paths are authored as solid
   * silhouettes with holes expressed via even-odd winding. `'stroke'`
   * is right for line glyphs (the lib's built-in icon set, generic
   * primitives like server / database / cloud / lock / code that we
   * register as "generic" platforms — no real brand, just a category
   * hint when the user hasn't picked a specific tech yet).
   *
   * The IconSlot's render mode follows this field 1:1; the picker
   * grid (`CreateServiceCanvasDialog`) uses it too so the tile
   * preview matches the on-canvas render style.
   */
  renderMode?: "fill" | "stroke";
  /**
   * Source coordinate space of the path data. `24` (default) matches
   * simple-icons brand glyphs; `16` matches the lib's built-in line-
   * glyph icon set (the generic primitives — server / database /
   * cloud / network / lock / code). Affects both the IconSlot's
   * `viewBox` field and the picker grid's `<svg viewBox>`.
   */
  viewBox?: 16 | 24;
  /**
   * Official brand color. Reserved for v2 (per-platform accent stripe /
   * tinted card body). Today the canvas uses the generic service-cyan
   * for every card regardless. Stored here so adding the accent later
   * is a single render-site change, not a data migration.
   */
  brandColor?: string;
}
