/** Seeded jitter: the same id draws the same hand-made line on every render. */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a [0, 1) generator from a string seed. */
export function seeded(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface P {
  x: number;
  y: number;
}

/** A wobbling pen stroke along the same S-curve a bezier edge takes, from (sx, sy) to (tx, ty). */
export function inkPath(seed: string, sx: number, sy: number, tx: number, ty: number, wobble = 1.8): string {
  const rnd = seeded(seed);
  const dx = Math.max(40, Math.abs(tx - sx) * 0.5);
  const c1: P = { x: sx + dx, y: sy };
  const c2: P = { x: tx - dx, y: ty };
  const steps = 14;
  const pts: P[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * u * sx + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * tx;
    const y = u * u * u * sy + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * ty;
    const edge = i === 0 || i === steps ? 0.3 : 1;
    pts.push({ x: x + (rnd() - 0.5) * 2 * wobble * edge, y: y + (rnd() - 0.5) * 2 * wobble * edge });
  }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

/** A hand-drawn, slightly open ellipse (a pen circle) filling a w × h box. */
export function penCircle(seed: string, w: number, h: number): string {
  const rnd = seeded(seed);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - 3;
  const ry = h / 2 - 3;
  const turns = 1.08;
  const n = 36;
  const start = rnd() * Math.PI * 2;
  let d = "";
  for (let i = 0; i <= n; i++) {
    const a = start + (i / n) * Math.PI * 2 * turns;
    const grow = 1 + (i / n) * 0.04 + (rnd() - 0.5) * 0.025;
    const x = cx + Math.cos(a) * rx * grow;
    const y = cy + Math.sin(a) * ry * grow;
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

/** A small seeded tilt in degrees, for sticky notes. */
export const tilt = (seed: string, max = 1.6) => (seeded(seed + "tilt")() - 0.5) * 2 * max;
