# system-canvas — drop-on-node interaction

A new library-level interaction: dragging a node and dropping it on top of another node fires a `onNodeDrop` event. The dropped node returns to its original position; the consumer decides what the drop *means* and mutates accordingly.

The animating use case is **organizing features into milestones** on the Hive org canvas. A user accumulates loose features on an initiative sub-canvas, then later groups them into milestones by dragging each feature card onto the milestone it belongs to. The consumer (`OrgCanvasBackground`) intercepts the drop and PATCHes `Feature.milestoneId`; on the next read the feature stops projecting on the initiative canvas and starts projecting on the milestone sub-canvas.

The interaction generalizes beyond features → milestones. Future Hive uses include:
- Drag a task onto a different feature to reassign.
- Drag a feature onto another feature to express a dependency.
- Drag a note onto a live node to attach the note as a comment.

The library's job is to deliver clean drop semantics; consumers wire each pairing to its own data mutation.

---

## Why the library, not the consumer

Three reasons we want this in `system-canvas`, not in `OrgCanvasBackground`:

1. **Hit-testing during drag belongs to the renderer.** The library already tracks node bounds for selection and edge-drawing; computing "is this drag's current pointer over node X" is a small extension of the existing machinery. Rebuilding it from the consumer side would mean duplicating the spatial index and the viewport math.

2. **Visual feedback during the drag belongs to the renderer.** A droppable target wants to highlight on hover (slight outline / tint), and a non-droppable hover should produce no feedback. That's a per-frame paint concern; the consumer can't reach into the render loop without weird prop-driven hacks.

3. **Reusability.** Drop-onto-node is a generic interaction. Putting it in the library means future consumers (other apps, tests) get it for free with the same predictable contract.

---

## API shape

Two new optional props on `<SystemCanvas>`. Both default to "no drop interaction" (current behavior preserved):

```ts
interface SystemCanvasProps {
  // ...existing props...

  /**
   * Predicate consulted while dragging a node. When the pointer hovers
   * over another node, the library calls this with `(source, target)`.
   *
   *   - `true`  → target gets the "droppable" highlight; on release
   *               `onNodeDrop` fires, source snaps back to its
   *               pre-drag position.
   *   - `false` → no highlight; on release the drag falls through to
   *               normal repositioning (the source ends up at the
   *               pointer's release coords as if the target weren't
   *               there).
   *
   * Self-drop (`source.id === target.id`) is filtered by the library
   * before this is called — consumers don't need to special-case it.
   *
   * Called frequently during drag; keep it cheap (no fetches, no
   * setState). Pure derivation from `source.category` /
   * `target.category` / `source.id` / `target.id` is the expected
   * shape.
   */
  canDropNodeOn?: (source: CanvasNode, target: CanvasNode) => boolean;

  /**
   * Fires once, on pointer release, when a drag ended over a node
   * that `canDropNodeOn` accepted. The library has already snapped
   * the source back to its pre-drag position by the time this fires;
   * the consumer's job is purely to mutate data and trigger a refetch.
   *
   * `ctx.canvasRef` matches the rest of the library's callbacks: the
   * scope the drop happened on, with `null` for the root canvas.
   *
   * Not called when:
   *   - The drop landed on empty space (handled as a normal drag).
   *   - The drop landed on a node where `canDropNodeOn` returned
   *     `false` (handled as a normal drag).
   *   - `canDropNodeOn` is not provided (drop interaction off).
   */
  onNodeDrop?: (
    source: CanvasNode,
    target: CanvasNode,
    ctx: { canvasRef: string | null }
  ) => void;
}
```

### Why a snap-back default

When the consumer accepts a drop, the most common follow-up is a data mutation that **changes which canvas the source node belongs to** (assigning a feature to a milestone moves it from the initiative canvas to the milestone sub-canvas). After the next read, the source node won't render on the original canvas at all — so leaving it at the dropped coords for one frame is visually meaningless.

Snapping back also avoids the orphan-position-overlay problem: if the source had a `Canvas.data.positions[<liveId>]` entry on its old canvas and we left it at drop-coords, the consumer's autosave path would persist the new position right before the projection rules pull the node off the canvas — we'd write a position overlay for a node that no longer renders there.

If a future consumer wants the dropped node to *stay* at drop coords (e.g. drop-to-attach where the source still belongs to its original canvas), we can add an `onNodeDrop` return value (`{ stayAtDropCoords: true }`) without breaking the default contract.

### Why `canDropNodeOn` separate from `onNodeDrop`

We could collapse them into a single `onNodeDrop` that consumers no-op when the drop is invalid. Splitting them buys two things:

1. **Hover feedback during drag.** The library only knows whether to highlight a target if the consumer has expressed a per-pair predicate it can run cheaply per frame.
2. **Snap-back vs. normal-drag distinction.** When the predicate says "yes," releasing snaps back. When it says "no," releasing falls through to normal repositioning. Without the predicate, the library can't tell which behavior the consumer wants on release.

The two-prop design is a small ergonomic cost (consumers write the matching condition twice — once in `canDropNodeOn`, once in `onNodeDrop` to defensively re-validate). Worth it for the cleaner UX.

---

## Visual feedback

When `canDropNodeOn(source, target)` returns `true` and the source is being dragged with the pointer over the target, paint the target with a "droppable" treatment. Suggestions:

- A 2px outline in the theme's accent color (matches the existing selection highlight, but distinguishably different — maybe a dashed stroke vs. solid).
- A subtle inner glow / tint on the target's fill (~10% alpha of the accent color).
- Cursor flips to a "grabbing-can-drop" affordance if the platform supports a custom cursor here.

The dragged source itself can also gain a "carrying" treatment (slightly elevated shadow, lower opacity) — that's already conventional for drag-from-source feedback in most canvas apps.

When the predicate returns `false` while hovering, no special treatment is applied to either node. The drag looks identical to a normal reposition drag passing over an obstacle.

---

## Edge cases the library should handle internally

- **Self-drop.** If `source.id === target.id`, neither `canDropNodeOn` nor `onNodeDrop` fires. Pure library-side guard.

- **Source dragged off-canvas mid-drag.** If the pointer leaves the viewport entirely and is released outside, treat it as a regular drag-end (no drop event). Existing library behavior already handles this for plain drags; the drop layer should defer to it.

- **Target deleted mid-drag.** If the target node is removed from the canvas data while a drag-over is in progress (e.g. agent edit, Pusher refresh), drop the highlight and fall back to normal drag-end on release. Don't fire `onNodeDrop` with a target that no longer exists.

- **Stacked targets.** When the pointer is over multiple overlapping nodes, prefer the topmost (highest z / last-rendered) for hit-testing. Same convention the library already uses for `onNodeClick`.

- **Drop during pan/zoom.** If the user is mid-drag and starts a pan or pinch-zoom (multi-touch), the drag should cancel cleanly. No drop event.

- **Live-id awareness.** The library should NOT inspect node id prefixes. Live-vs-authored is consumer-side knowledge; the predicate is the consumer's place to encode it (`canDropNodeOn: (s, t) => s.category === "feature" && t.category === "milestone"`).

---

## Multi-select

If the library supports multi-select drags (it currently does in some configurations), we have two options:

**Option A — first-class multi-source drop.**
```ts
onNodeDrop?: (
  sources: CanvasNode[],
  target: CanvasNode,
  ctx: { canvasRef: string | null }
) => void;
```

`canDropNodeOn` accepts the array too, so the consumer can reject mixed-category drags.

**Option B — fire `onNodeDrop` once per source.**
Simpler library code; consumer handles batching themselves. Risk: each call hits the data layer separately, which is fine for tens but gross for hundreds.

I'd ship **A**. The consumer use case for "assign 6 features to a milestone in one gesture" is concrete (the user has multi-selected the features beforehand). One mutation request beats six.

If multi-select is out of scope for v1 of this library feature, ship single-source for now and design A as the v2 extension. The v1 signature should be the array-from-the-start version with a length-1 invariant — that way upgrading to true multi-select doesn't break callers:

```ts
// v1 — always a single-element array, but the type is plural
onNodeDrop?: (
  sources: CanvasNode[],
  target: CanvasNode,
  ctx: { canvasRef: string | null }
) => void;
```

(Pick whichever you prefer; I have a slight preference for "array now, single-element invariant" because it future-proofs.)

---

## What changes for consumers

Once the library ships:

1. The Hive org canvas (`OrgCanvasBackground.tsx`) wires `canDropNodeOn` and `onNodeDrop` to handle the feature → milestone case.

2. The Hive backend grows a `PATCH /api/features/[id]` capability that accepts `milestoneId` (it already exists for other fields; we'd extend `UpdateFeatureRequest`). The route fires `CANVAS_UPDATED` on:
   - The **previous** canvas (`initiative:<x>` if the feature was loose, `milestone:<old>` if it was already milestone-bound).
   - The **new** canvas (`milestone:<new>`).

3. The `updateFeature` service re-derives `initiativeId` from the new milestone (mirroring `createFeature`'s invariant, which we already shipped) so a feature's `initiativeId` always matches `milestone.initiativeId` when both are set.

4. The `CANVAS.md` "Side-channel DB writes" gotcha gets a new bullet: "drag-and-drop assignments." Pattern: source node and target node both come through the drop event; consumer translates the drop into a PATCH; Pusher fan-out across affected scopes.

None of those consumer changes are blocked by the library; we can stub them and merge alongside the library upgrade.

---

## What's deliberately NOT in scope here

- **Drop on empty space** to mean something. The library already treats empty-space drops as normal repositioning, and that's the right default. If a future consumer wants "drop on empty space = create a new linked entity," it should be a separate API surface (a `onCanvasDrop(source, point, ctx)` event), not folded into `onNodeDrop`.

- **Drag from outside the canvas** (e.g. from a sidebar list onto a canvas node). Different mechanism — needs HTML5 DnD interop or a portal-based drag handle. Out of scope for "node-on-node within the canvas."

- **Drag from canvas to outside.** Same — different mechanism. Useful for "drag a feature onto a kanban column in the right panel" eventually, but separate concern.

- **Drop reordering** (drop a node between two siblings to insert it at that position). The current use case is membership change ("which milestone does this feature belong to"), not ordering. If a future use case wants ordering, the predicate gets refined with a "drop zone" concept and the event payload grows a `position: "before" | "after" | "inside"` field.

---

## Migration / back-compat

Both new props are optional. Existing consumers see no behavior change.

When `canDropNodeOn` is `undefined`, the library skips the new code path entirely:
- No predicate calls during drag.
- No special highlight on hover.
- No `onNodeDrop` event on release.
- Drag-end behaves exactly as today.

This is the cleanest possible rollout — consumers opt in by adding the predicate.

---

## Test ideas

- **Predicate respected.** A `canDropNodeOn` that always returns `false` produces no `onNodeDrop` events, no matter how the user drags.
- **Self-drop guarded.** A `canDropNodeOn` that always returns `true` still doesn't fire when source.id === target.id.
- **Snap-back.** After a successful drop, the source node's position in the model is unchanged from before the drag (consumers rely on this when asserting the drop didn't trigger an autosave race).
- **Hover highlight tied to predicate.** During drag, the target's "droppable" class is applied iff `canDropNodeOn` returned true on the most recent hover.
- **Cleanup.** Mid-drag, if the target is removed from the canvas data, the highlight clears and a release fires no event.
- **Stacked nodes.** With overlapping nodes A (bottom) and B (top), a drag-over event reports B as the target.

---

## Open questions for you

1. **Multi-select.** Worth shipping `sources: CanvasNode[]` v1, or single-source first? My vote: array with length-1 invariant.

2. **Drop highlight tokens.** Should the "droppable" outline / fill colors be theme-driven (consumer-configurable via `CanvasTheme`) or hardcoded library defaults? My vote: theme-driven, with sensible defaults — same pattern as selection highlight.

3. **`canDropNodeOn` performance contract.** Worth documenting "called O(targets) per drag-frame" in the JSDoc so consumers know not to do anything expensive there? (My vote: yes — same kind of hot-path warning the React docs put on `useMemo` deps.)

4. **`onNodeDrop` async return value.** Consumers will often want to do an async PATCH and refetch. Should the library `await` a returned Promise (and show a "saving" state on the source node until it resolves)? Or fire-and-forget? My vote: fire-and-forget for v1 — keeps the lib simple. Consumers do their own optimistic UI.
