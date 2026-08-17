/**
 * OOXML unit conversion utilities.
 *
 * OOXML uses several unit systems:
 * - Twips (twentieths of a point): paragraph spacing, indent, margin
 * - EMU (English Metric Units, 914400 per inch): image dimensions
 * - Half-points: font sizes in w:sz
 * - Points: used in some spacing values
 */

const POINTS_PER_INCH = 72;
const PX_PER_INCH = 96;
const PX_PER_POINT = PX_PER_INCH / POINTS_PER_INCH; // 96/72 = 1.333...
const TWIPS_PER_POINT = 20;
const TWIPS_PER_INCH = TWIPS_PER_POINT * POINTS_PER_INCH; // 1440
const EMU_PER_INCH = 914400;

/**
 * Convert twips (twentieths of a point) to pixels.
 * Used for paragraph spacing, indents, margins.
 */
export function twipsToPx(twips: number): number {
  const inches = twips / TWIPS_PER_INCH;
  return inches * PX_PER_INCH;
}

/**
 * Convert EMU (English Metric Units) to pixels.
 * Used for image/drawing dimensions.
 */
export function emuToPx(emu: number): number {
  const inches = emu / EMU_PER_INCH;
  return inches * PX_PER_INCH;
}

/**
 * Convert half-points to pixels.
 * w:sz stores font size in half-points (e.g. 24 = 12pt).
 */
export function halfPointsToPx(halfPoints: number): number {
  const points = halfPoints / 2;
  return points * PX_PER_POINT;
}

/**
 * Convert points to pixels.
 */
export function pointsToPx(points: number): number {
  return points * PX_PER_POINT;
}
