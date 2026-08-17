/**
 * Resolves a list marker string (e.g. "1.", "(a)", "•") for a given
 * paragraph's numId + ilvl combination.
 */

import { NumberingMap } from "../types/document";

/** Runtime counters for each (numId, ilvl) pair */
const counters = new Map<string, number>();

/** Reset all counters (call between documents in tests) */
export function resetNumberingCounters(): void {
  counters.clear();
}

function counterKey(numId: number, ilvl: number): string {
  return `${numId}:${ilvl}`;
}

function toAlpha(n: number): string {
  // 1→a, 2→b, …, 26→z, 27→aa, etc.
  let result = "";
  while (n > 0) {
    n--;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function toRoman(n: number): string {
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const syms = [
    "m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i",
  ];
  let result = "";
  for (let i = 0; i < vals.length; i++) {
    while (n >= vals[i]) {
      result += syms[i];
      n -= vals[i];
    }
  }
  return result;
}

function formatCounter(fmt: string, n: number): string {
  switch (fmt) {
    case "decimal":
      return String(n);
    case "upperRoman":
      return toRoman(n).toUpperCase();
    case "lowerRoman":
      return toRoman(n);
    case "upperLetter":
      return toAlpha(n).toUpperCase();
    case "lowerLetter":
      return toAlpha(n);
    case "ordinal": {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    case "bullet":
    case "none":
    default:
      return "";
  }
}

/**
 * Resolve a list marker string for the given numId + level.
 *
 * Returns a string like "1.", "(a)", "•", or "" if not resolvable.
 *
 * Side effect: increments the counter for this (numId, ilvl) and resets
 * deeper-level counters (as Word does).
 */
export function resolveListMarker(
  numId: number,
  ilvl: number,
  numbering: NumberingMap
): string {
  const numDef = numbering.numDefs.get(numId);
  if (!numDef) return "";

  const abstractDef = numbering.abstractDefs.get(numDef.abstractNumId);
  if (!abstractDef) return "";

  // Find level definition, considering overrides
  let levelDef = abstractDef.levels.find((l) => l.level === ilvl);
  if (!levelDef) return "";

  // Apply level overrides from num definition
  if (numDef.levelOverrides) {
    const override = numDef.levelOverrides.find((o) => o.level === ilvl);
    if (override) {
      levelDef = { ...levelDef, ...override };
    }
  }

  if (levelDef.numFmt === "bullet" || levelDef.numFmt === "none") {
    return levelDef.lvlText || "•";
  }

  const key = counterKey(numId, ilvl);

  // Increment counter for this level
  const current = (counters.get(key) ?? levelDef.start - 1) + 1;
  counters.set(key, current);

  // Reset counters for deeper levels
  for (let deeper = ilvl + 1; deeper <= 8; deeper++) {
    const deeperKey = counterKey(numId, deeper);
    const deeperAbstractLevel = abstractDef.levels.find(
      (l) => l.level === deeper
    );
    if (counters.has(deeperKey)) {
      counters.set(
        deeperKey,
        deeperAbstractLevel ? deeperAbstractLevel.start - 1 : 0
      );
    }
  }

  // Replace %N tokens in lvlText with the counter for level N-1
  let marker = levelDef.lvlText;
  marker = marker.replace(/%(\d)/g, (_, digit) => {
    const refLevel = Number(digit) - 1;
    if (refLevel === ilvl) {
      return formatCounter(levelDef!.numFmt, current);
    }
    const refKey = counterKey(numId, refLevel);
    const refCount = counters.get(refKey) ?? 1;
    const refAbstractLevel = abstractDef.levels.find(
      (l) => l.level === refLevel
    );
    return formatCounter(
      refAbstractLevel?.numFmt ?? "decimal",
      refCount
    );
  });

  return marker;
}
