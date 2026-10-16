/**
 * Pure helpers for the captcha viewer's taps: a tap is a point on the
 * rendered image as fractions (0–1) of its box, so the answer does not
 * depend on how big the image was drawn. With a grid, a tap toggles the cell
 * under it and is stored as that cell's centre.
 */

export interface Tap {
  nx: number;
  ny: number;
}

export interface CaptchaGrid {
  rows: number;
  cols: number;
}

export interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CellRect {
  index: number;
  row: number;
  col: number;
  /** Percent of the image box. */
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** A pointer position as fractions of the rendered image's box, clamped to 0–1. */
export function tapFromPointer(clientX: number, clientY: number, rect: BoxRect): Tap {
  if (rect.width <= 0 || rect.height <= 0) return { nx: 0, ny: 0 };
  return { nx: clamp01((clientX - rect.left) / rect.width), ny: clamp01((clientY - rect.top) / rect.height) };
}

/** The grid cell containing a tap, row-major index. The far edge belongs to the last cell. */
export function tapToCell(tap: Tap, grid: CaptchaGrid): { row: number; col: number; index: number } {
  const col = Math.min(grid.cols - 1, Math.floor(clamp01(tap.nx) * grid.cols));
  const row = Math.min(grid.rows - 1, Math.floor(clamp01(tap.ny) * grid.rows));
  return { row, col, index: row * grid.cols + col };
}

/** The centre of a cell, as a tap. */
export function cellCentre(index: number, grid: CaptchaGrid): Tap {
  const row = Math.floor(index / grid.cols);
  const col = index % grid.cols;
  return { nx: (col + 0.5) / grid.cols, ny: (row + 0.5) / grid.rows };
}

/** The cells tapped, by index. */
export function tappedCells(taps: readonly Tap[], grid: CaptchaGrid): Set<number> {
  return new Set(taps.map((t) => tapToCell(t, grid).index));
}

/** A tap on a cell: tapped → untapped, else its centre is added. */
export function toggleCellTap(taps: readonly Tap[], tap: Tap, grid: CaptchaGrid): Tap[] {
  const { index } = tapToCell(tap, grid);
  if (tappedCells(taps, grid).has(index)) return taps.filter((t) => tapToCell(t, grid).index !== index);
  return [...taps, cellCentre(index, grid)];
}

/** A tap with no grid adds a dot, in order. */
export function addTap(taps: readonly Tap[], tap: Tap): Tap[] {
  return [...taps, tap];
}

/** A dot tapped again is removed. */
export function removeTap(taps: readonly Tap[], i: number): Tap[] {
  return taps.filter((_, at) => at !== i);
}

/** Every cell's box in percent of the image, for the overlay. */
export function overlayCells(grid: CaptchaGrid): CellRect[] {
  const cells: CellRect[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      cells.push({ index: row * grid.cols + col, row, col, left: (col / grid.cols) * 100, top: (row / grid.rows) * 100, width: 100 / grid.cols, height: 100 / grid.rows });
    }
  }
  return cells;
}

/** `3 tiles tapped / 6 not tapped`. */
export function tileSummary(taps: readonly Tap[], grid: CaptchaGrid): string {
  const tapped = tappedCells(taps, grid).size;
  const total = grid.rows * grid.cols;
  return `${tapped} ${tapped === 1 ? "tile" : "tiles"} tapped / ${total - tapped} not tapped`;
}

// ─── The manifest ────────────────────────────────────────────────────────

const IMAGE_FILE = /^[\w.-]+\.(png|jpe?g|webp|gif)$/i;

const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const int = (v: unknown, max: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : undefined);

export interface CaptchaManifest {
  /** The image's strut key, a sibling of the manifest in the same job. */
  imageKey?: string;
  instruction?: string;
  site?: string;
  mode?: "tap" | "text" | "either";
  round?: number;
  maxRounds?: number;
  expiresAt?: string;
  grid?: CaptchaGrid;
  state?: "waiting" | "sent" | "solved" | "failed" | "expired";
}

/** The manifest json at `key`, read for the viewer; the image is a plain file name beside it, never a path. Null when it is not an object. */
export function parseCaptchaManifest(raw: unknown, key: string): CaptchaManifest | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const dir = key.slice(0, key.lastIndexOf("/") + 1);
  const file = str(m.image, 200);
  const grid = typeof m.grid === "object" && m.grid !== null ? (m.grid as Record<string, unknown>) : null;
  const rows = grid ? int(grid.rows, 20) : undefined;
  const cols = grid ? int(grid.cols, 20) : undefined;
  const state = (["waiting", "sent", "solved", "failed", "expired"] as const).find((s) => s === m.state);
  const mode = (["tap", "text", "either"] as const).find((s) => s === m.mode);
  const instruction = str(m.instruction, 500);
  const site = str(m.site, 253);
  const round = int(m.round, 1000);
  const maxRounds = int(m.maxRounds, 1000);
  const expiresAt = str(m.expiresAt, 40);
  return {
    ...(file && IMAGE_FILE.test(file) ? { imageKey: `${dir}${file}` } : {}),
    ...(instruction ? { instruction } : {}),
    ...(site ? { site } : {}),
    ...(mode ? { mode } : {}),
    ...(round ? { round } : {}),
    ...(maxRounds ? { maxRounds } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(rows && cols ? { grid: { rows, cols } } : {}),
    ...(state ? { state } : {}),
  };
}

/** Whole milliseconds left until `expiresAt`; null when none or unparseable. */
export function msLeft(expiresAt: string | undefined, now: number): number | null {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) ? null : at - now;
}

/** `m:ss` for a time left. */
export function clockOf(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
