/** Board state kept in this browser only — never written to the graph. */

export interface Pos {
  x: number;
  y: number;
}
export interface BoardNote extends Pos {
  id: string;
  text: string;
}

export const posKey = (root: string) => `brainstorm-board:pos:${root}`;
export const notesKey = (root: string) => `brainstorm-board:notes:${root}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full — the board just won't remember.
  }
}

const isPos = (p: unknown): p is Pos =>
  !!p && typeof p === "object" && Number.isFinite((p as Pos).x) && Number.isFinite((p as Pos).y);

export function loadPositions(root: string): Record<string, Pos> {
  const raw = read<Record<string, unknown>>(posKey(root), {});
  return Object.fromEntries(Object.entries(raw).filter(([, p]) => isPos(p))) as Record<string, Pos>;
}
export const savePositions = (root: string, positions: Record<string, Pos>) => write(posKey(root), positions);

export function loadNotes(root: string): BoardNote[] {
  const raw = read<unknown[]>(notesKey(root), []);
  return Array.isArray(raw)
    ? raw.filter((n): n is BoardNote => isPos(n) && typeof (n as BoardNote).id === "string" && typeof (n as BoardNote).text === "string")
    : [];
}
export const saveNotes = (root: string, notes: BoardNote[]) => write(notesKey(root), notes);
