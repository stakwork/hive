/**
 * Where everything stands in the System view's world, in world units. Pure.
 *
 * Slots are deterministic by construction, with nothing stored: zones run
 * left to right in world order; a zone's districts fill a fixed grid of
 * `ZONE_COLS` columns, row after row downward; a district is a fixed-size cell
 * with its hub and claimed nodes on top and a fixed grid of stack slots under
 * them (`STACK_COLS` x `STACK_ROWS`); a stack's tiers stand upward from the
 * slot's baseline in fixed `TIER_W` x `TIER_H`. So a new district, feature or
 * tier takes the next free slot and moves nothing that was already placed
 * (apart from a district that sorts before others in its zone, or a zone that
 * sorts before others in the world, which shifts what follows it, as the order
 * says). What doesn't fit its slots (a stack's tiers past `MAX_TIERS`, stacks
 * past the grid) is counted, not drawn: the List view has all of it.
 */

import type { Rect } from "../scene";
import type { District, SystemModel, Tier } from "./model";

export const TIER_W = 210;
export const TIER_H = 46;
export const TIER_GAP = 6;
export const MAX_TIERS = 3;
export const STACK_COLS = 3;
export const STACK_ROWS = 1;
const COL_GAP = 14;
const PAD = 20;
export const HEADER_H = 120;
const LABEL_H = 22;
export const BAND_H = MAX_TIERS * (TIER_H + TIER_GAP) + LABEL_H;
export const CELL_W = PAD * 2 + STACK_COLS * (TIER_W + COL_GAP) - COL_GAP;
export const CELL_H = HEADER_H + STACK_ROWS * BAND_H + PAD;
export const ZONE_COLS = 2;
const CELL_GAP = 24;
const PLATE_PAD = 30;
export const PLATE_HEAD = 64;
export const PLATE_W = PLATE_PAD * 2 + ZONE_COLS * CELL_W + (ZONE_COLS - 1) * CELL_GAP;
const PLATE_GAP = 90;
export const UNMAPPED_W = 520;
export const UNMAPPED_ROWS = 8;
const UNMAPPED_HEAD = 56;
const UNMAPPED_ROW = 30;
export const UNMAPPED_H = UNMAPPED_HEAD + UNMAPPED_ROWS * UNMAPPED_ROW + 24;
export const STACK_SLOTS = STACK_COLS * STACK_ROWS;

export interface DistrictBox {
  id: string;
  rect: Rect;
  /** The hub card, and the band the claimed nodes sit in. */
  hub: Rect;
  slots: Rect;
  /** Stacks that didn't fit their grid, and tiers past `MAX_TIERS`, in all. */
  overflow: number;
}

export interface TierBox {
  id: string;
  rect: Rect;
  district: string;
  stack: number;
  index: number;
}

export interface SystemLayout {
  plates: Array<{ key: string; label: string; rect: Rect }>;
  districts: Map<string, DistrictBox>;
  tiers: Map<string, TierBox>;
  unmapped: Rect;
  /** Everything, for framing the world. */
  bounds: Rect;
}

const unionOf = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

function layoutDistrict(d: District, x: number, y: number, boxes: SystemLayout["tiers"]): DistrictBox {
  const rect = { x, y, w: CELL_W, h: CELL_H };
  let overflow = 0;
  d.stacks.forEach((stack, s) => {
    if (s >= STACK_SLOTS) {
      overflow += stack.length;
      return;
    }
    const col = s % STACK_COLS;
    const row = Math.floor(s / STACK_COLS);
    const left = x + PAD + col * (TIER_W + COL_GAP);
    const baseline = y + HEADER_H + (row + 1) * BAND_H - LABEL_H;
    stack.forEach((t: Tier, i) => {
      if (i >= MAX_TIERS) {
        overflow++;
        return;
      }
      boxes.set(t.id, {
        id: t.id,
        district: d.id,
        stack: s,
        index: i,
        rect: { x: left, y: baseline - (i + 1) * (TIER_H + TIER_GAP) + TIER_GAP, w: TIER_W, h: TIER_H },
      });
    });
  });
  return {
    id: d.id,
    rect,
    hub: { x: x + PAD, y: y + PAD, w: 190, h: HEADER_H - PAD * 2 },
    slots: { x: x + PAD + 200, y: y + PAD, w: CELL_W - PAD * 2 - 200, h: HEADER_H - PAD * 2 },
    overflow,
  };
}

export function layoutSystem(model: SystemModel): SystemLayout {
  const plates: SystemLayout["plates"] = [];
  const districts = new Map<string, DistrictBox>();
  const tiers = new Map<string, TierBox>();
  let x = 0;
  for (const zone of model.zones) {
    const rows = Math.max(1, Math.ceil(zone.districts.length / ZONE_COLS));
    zone.districts.forEach((d, i) => {
      const col = i % ZONE_COLS;
      const row = Math.floor(i / ZONE_COLS);
      districts.set(
        d.id,
        layoutDistrict(
          d,
          x + PLATE_PAD + col * (CELL_W + CELL_GAP),
          PLATE_HEAD + PLATE_PAD + row * (CELL_H + CELL_GAP),
          tiers,
        ),
      );
    });
    plates.push({
      key: zone.key,
      label: zone.label,
      rect: { x, y: 0, w: PLATE_W, h: PLATE_HEAD + PLATE_PAD * 2 + rows * CELL_H + (rows - 1) * CELL_GAP },
    });
    x += PLATE_W + PLATE_GAP;
  }
  const unmapped = { x, y: 0, w: UNMAPPED_W, h: UNMAPPED_H };
  const bounds = unionOf([...plates.map((p) => p.rect), unmapped]);
  return { plates, districts, tiers, unmapped, bounds };
}

/** The rect to fly to for a district or a tier (a tier that wasn't drawn falls back to its district). */
export function rectFor(layout: SystemLayout, model: SystemModel, id: string): Rect | undefined {
  const tier = layout.tiers.get(id);
  if (tier) return tier.rect;
  const d = layout.districts.get(id);
  if (d) return d.rect;
  const t = model.tiers.get(id);
  return t ? layout.districts.get(t.district)?.rect : undefined;
}
