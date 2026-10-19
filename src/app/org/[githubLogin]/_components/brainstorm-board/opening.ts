/**
 * Where the desk opens, from the link's `?root=` / `?node=`: the brainstorm
 * `root` names (a block key), or the card `root` is inside of, or — with
 * `node` — the card to point at inside `root`'s brainstorm. Anything the desk
 * does not know fits the whole desk.
 */
export type OpeningFocus = { kind: "block"; key: string; card?: string } | { kind: "fit" };

export function openingFocus(
  root: string | null,
  node: string | null,
  isBlock: (key: string) => boolean,
  blockOfCard: (id: string) => string | undefined,
): OpeningFocus {
  if (root && isBlock(root)) {
    // A card of that brainstorm, else just the brainstorm.
    return node && blockOfCard(node) === root ? { kind: "block", key: root, card: node } : { kind: "block", key: root };
  }
  const owner = root ? blockOfCard(root) : undefined;
  if (root && owner) return { kind: "block", key: owner, card: root };
  return { kind: "fit" };
}
