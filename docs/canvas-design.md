# Canvas — Design Document

> Status: draft / thinking document. Not a spec. Meant to be argued with.

## 1. What we're building

A visual, infinitely nestable, agent-editable canvas that sits at the top level of every Hive org. The canvas is the product: the place where humans and agents together hold the moving pieces of an organization in mind — workspaces, repos, initiatives, features, tasks, people, customers, revenue, notes, visions.

The canvas uses the [`system-canvas-react`](https://www.npmjs.com/package/system-canvas-react) library for rendering. Each canvas is a `CanvasData` document (nodes, edges, theme). Nodes can have a `ref` pointing to a sub-canvas, giving unlimited nesting. Clicking a node with a `ref` calls `onResolveCanvas(ref)` and renders the child.

Guiding principle: **the roadmap is the product.** A high-level UI lets a human hold initiatives, features, tasks, agents, and humans in their head through a single visual surface, with a first-class chat that can explore and alter the canvas alongside them.

## 2. The central tension

Canvases need to represent two kinds of knowledge, and they blur into each other:

- **Structural** — real Hive entities: workspaces, repositories, features, phases, tasks, members, eventually files and concepts. These exist in the DB whether a canvas renders them or not.
- **Narrative** — editorial knowledge that only exists on canvases: the CEO's initiative that spans three workspaces, a sticky note from a standup, a "this blocks that" edge the agent inferred, a customer cluster, a revenue target.

The tension the user surfaced:
- A **structural** node (a repo) still needs an agent or human to *position* it and *connect* it to other structural nodes on a given canvas — those choices are editorial.
- A **narrative** node (a sticky "we should build a stakeholder dashboard") can **graduate** into a structural one (a real `Feature` in Hive), without losing its identity, position, or incoming edges on the canvas.

Any model that treats structural and narrative as two separate things will eventually have to reconcile them. We should design so they're the same thing from the start.

## 3. The model: one node table, one binding

Every node is a row in `CanvasNode`. Every row carries an optional **binding** to a Hive entity. The canvas owns position, visual style, and topology. Hive owns entity identity and content. The binding is the bridge.

```
CanvasNode
  id               -- canvas-owned, stable across rebinding
  canvasId         -- which canvas this node lives on
  nodeKey          -- string used as "id" inside the CanvasData JSON (derived from id; stable)
  x, y             -- position
  width, height    -- optional; fall back to category defaults
  category         -- "workspace" | "repo" | "feature" | "task" | "note" | "vision" | …
  color, icon      -- optional, overrides category
  textOverride     -- if present, displayed text; otherwise derived from binding
  props jsonb      -- escape hatch: flags, meta, renderer hints, not-yet-promoted fields
  bindingKind      -- null | "workspace" | "repository" | "feature" | "phase" | "task" | "user" | "file" | "concept"
  bindingId        -- null or Hive entity id matching bindingKind
  createdAt, updatedAt
```

```
CanvasEdge
  id
  canvasId
  fromNodeId       -- CanvasNode.id
  toNodeId         -- CanvasNode.id
  fromSide, toSide -- optional anchor hints
  label
  color
  kind             -- "strategic" | "depends_on" | "blocks" | "customer" | "revenue" | "freeform"
  props jsonb
```

```
Canvas
  id
  orgId            -- every canvas belongs to an org (at minimum)
  workspaceId      -- nullable; set if this canvas is owned by a workspace
  parentCanvasId   -- nullable; the canvas a node in another canvas "opens into"
  parentNodeId     -- nullable; the specific node whose ref opened this canvas
  ref              -- unique per-org ref string, used by system-canvas (see §4)
  name
  theme jsonb      -- optional CanvasTheme override; null → inherit from org default
  isRoot           -- true for one canvas per org (the org root)
  createdAt, updatedAt
```

Why normalized (rows) rather than one jsonb doc per canvas: real-time collaboration with Pusher, concurrent agent edits, cross-canvas queries by binding ("which canvases reference this feature?"), and cheap on-wire deltas. `props jsonb` gives us the schema-evolution escape hatch where we need it. See §11 for the recorded tradeoff analysis.

### How it handles the tension

- **Structural node, agent lays it out** — node has a `bindingKind`/`bindingId`; `x`/`y` are canvas-owned and mutable by agent or human via the same `move_node` call. Text defaults to the Hive entity's name unless `textOverride` is set.
- **Narrative node graduates to structural** — an unbound node has its `bindingKind`/`bindingId` set. The `id`, `x`, `y`, all incoming and outgoing edges, and on-canvas history are preserved. One row updates. From that point forward the node's text pulls from the bound entity (unless overridden).
- **Bound entity is deleted in Hive** — default behavior: the node becomes unbound, `textOverride` is set to the last-known name, a `props.orphaned = true` flag is set. No data loss; the canvas keeps its shape; the human or agent decides what to do with the orphan.
- **Same entity visualized on multiple canvases** — each visualization is its own `CanvasNode` row with its own position. They share a `bindingKind`/`bindingId` pair, so "find every canvas showing this feature" is a cheap indexed query.

## 4. Canvas refs and nesting

`system-canvas` treats sub-canvases as opaque refs — a node carries `ref: "something"` and the library calls `onResolveCanvas("something")` when clicked. We use structured refs so the server can resolve them deterministically.

Ref format: `canvas:<orgSlug>:<scope>` where `<scope>` is one of:

| Scope | Meaning | Auto-seeded content |
|---|---|---|
| `root` | The org's top canvas | Workspaces the user created, plus any authored nodes |
| `workspace:<id>` | Inside a workspace | Repositories + features; authored nodes overlay |
| `repo:<id>` | Inside a repository | Files/modules once we have code graph data; until then, empty + authored |
| `feature:<id>` | Inside a feature | Phases + tasks |
| `phase:<id>` | Inside a phase | Tasks |
| `freeform:<id>` | A freeform sub-canvas attached to any node | Empty; user/agent authored |

A node "opens into" a canvas when:
- its binding implies one (clicking a `workspace`-bound node opens `canvas:<org>:workspace:<id>`), **or**
- it has an explicit `props.refOverride` set (user/agent attached a freeform child canvas to this node).

This is why `parentCanvasId`/`parentNodeId` on `Canvas` are just breadcrumbs — refs do the real wiring. The parent fields are for auditing and breadcrumb UI.

### Where do "initiatives" live?

This is the user's hardest question. An initiative is a CEO-level vision that can touch features across workspaces. It doesn't belong inside any one workspace. Model:

- An **initiative** is a node on the org root canvas, category `"initiative"`. It has edges to feature nodes *wherever they live* — which means edges must be allowed across canvas boundaries. See §8.
- If an initiative deserves its own sub-canvas (timeline, assumptions, risks), it gets a `freeform:<id>` ref and the sub-canvas can include mirrored references to the cross-workspace features it touches.
- Initiatives can eventually be promoted to a real Hive entity if we add one (`Initiative` model) — same graduation mechanism as notes → features.

The point: initiatives are narrative until and unless they earn structural status. The canvas is where that proving happens.

## 5. Auto-seeding rules

Canvases are auto-seeded on first open, then diverge.

- **First open of `canvas:<org>:workspace:<id>`**: for every repo and every feature in the workspace, insert a `CanvasNode` row with the right binding, a default layout position, and category-default styling. Commit.
- **Subsequent opens**: existing rows stand. New Hive entities since last seed appear in an **"unplaced" tray** beside the canvas — the human or agent drops them in. This avoids jitter and respects human/agent layout choices.
- **Removed entities**: bound nodes whose target no longer exists are *not* auto-deleted. They become orphans (see §3). A banner: "3 items on this canvas reference deleted entities. Review."

The user or agent can always "reflow" — re-run the default layout on either the whole canvas or a selection. That's an explicit action, not a side effect.

## 6. Agent tool surface

The agent is a peer user of the canvas. Everything it can do, a human could do with a mouse, and vice versa. Keep the tool surface small and declarative.

```
canvas.open(ref)
  → { canvas, nodes, edges, children }  // enough to render + navigate

canvas.describe(nodeId)
  → rich detail: binding entity, recent activity, related nodes

canvas.add_node(canvasRef, { text, x, y, category, binding?, props? })
  → CanvasNode

canvas.update_node(nodeId, patch)           // move, rename, recolor, rebind
canvas.delete_node(nodeId)

canvas.add_edge(canvasRef, fromNodeId, toNodeId, { label, kind, color, props? })
canvas.update_edge(edgeId, patch)
canvas.delete_edge(edgeId)

canvas.promote_node(nodeId, { bindingKind, createEntity?: entityDraft })
  // either bind to an existing entity by id, or create a new entity and bind

canvas.attach_subcanvas(nodeId, { name, theme? })
  // creates a freeform:<id> sub-canvas and sets props.refOverride

canvas.reflow(canvasRef, selection?)
  // re-runs default layout on all or selected nodes

canvas.propose(canvasRef, diff)
  // stage changes for human review instead of applying directly
```

Every mutation emits a Pusher event on the org channel with a minimal delta. Clients apply optimistically. The agent's turn renders as the nodes appear one by one — the "glow" effect in the mockup.

## 7. Promotion flow (graduation)

Narrative → structural. This is the moment the canvas becomes part of the system of record.

1. Unbound node exists (e.g., `category: "note"`, text "Stakeholder Dashboard").
2. Human or agent invokes `promote_node`. Options:
   - **Bind to existing**: pick a `bindingKind` + pick a Hive entity id. Node updates in place.
   - **Create new entity**: supply a draft (e.g., `{ kind: "feature", name, workspaceId }`). Server creates the Hive entity and binds the node to it atomically.
3. Node's `id` is preserved. All edges intact. History visible.
4. If desired, also migrate `textOverride` → real entity name, clear override.

Inverse operation (`demote_node`) un-sets the binding without deleting the entity. The node becomes an unbound copy of the last-known state. Rare; mostly useful when an agent mis-binds.

## 8. Cross-canvas edges

Edges only make sense within a canvas *visually*. But initiatives demand conceptual edges across canvases ("this initiative touches features on workspaces A and B"). Two options:

- **Mirror nodes (Recommended)**: an initiative on the root canvas has edges only to nodes on the root canvas. When a feature is relevant, we place a *mirror node* on the root canvas — a `CanvasNode` with the same binding as the real feature node that lives inside its workspace sub-canvas. Mirrors are cheap (they're just another row with the same binding). The "find all nodes bound to feature X" query surfaces all mirrors.
- **Truly cross-canvas edges**: `CanvasEdge` allows `fromCanvasId !== toCanvasId`. Rendering is awkward (the edge has to terminate at a canvas boundary or a breadcrumb).

We start with mirrors. If users want to jump from a mirror to the real node's canvas, the library's navigation does that via the mirror's `ref`.

## 9. Wire format

The server resolves a ref to a `CanvasData` document that `system-canvas` can render directly:

```ts
// GET /api/orgs/:login/canvas?ref=canvas:<org>:root
{
  canvas: { id, ref, name, parentRef?, breadcrumbs: [...] },
  data: {                            // this is system-canvas CanvasData
    theme: { base, categories },
    nodes: [{ id: node.nodeKey, type, x, y, width, height, text, color, category, ref? }],
    edges: [{ id, fromNode, toNode, fromSide?, toSide?, label?, color? }]
  },
  bindings: {                        // sidechannel for the client to render rich meta
    [nodeKey]: { kind, id, name, meta: { … } }
  },
  unplaced: [                        // entities that exist in Hive but aren't on this canvas yet
    { kind, id, name, suggestedCategory }
  ]
}
```

The server merges rows + live Hive state. The client treats `data` as immutable input to `<SystemCanvas>`; it uses `bindings` for hover cards, health dots, and semantic zoom.

## 10. UI layout

Two deployment targets, in this order:

1. **v1 — replace empty state of `ConnectionsPage`** at `/org/[githubLogin]/connections`. Keep the existing right sidebar (Connections) and bottom chat (`OrgChat`). Add `<OrgCanvas>` as the main content when no connection is selected. Fastest way to prove the data loop.
2. **v2 — new root route `/org/[githubLogin]`** matching `mockup-combined-6.html`:
   - Left sidebar: workspaces + members (existing patterns)
   - Main area: `<OrgCanvas>` fills available space
   - Right edge: thin vertical toolbar (select / add node types / connect tool)
   - Bottom: resizable console that *is* `OrgChat`, styled to the mockup, with artifact cards (blockers, PRs, cascade)
   - Semantic zoom: compact cards at zoom <0.6; richer cards at zoom >1.2 (handled by custom node renderers passed to `SystemCanvas`)

`OrgCanvas` is the same component in both places; only the chrome differs.

## 11. Recorded decision: normalized rows over JSONB doc

We evaluated storing each canvas as a single `jsonb` column vs. normalized `CanvasNode`/`CanvasEdge` tables. Chose normalized because:

- **Concurrent edits** — two humans dragging + an agent streaming node creations work naturally with row-level writes. JSONB requires `version` column with retries, or CRDT, or server-serialized patches.
- **Pusher deltas** — normalized = send `{nodeId, x, y}`. JSONB = either send the full doc or design a patch protocol.
- **Cross-canvas queries by binding** — "which canvases visualize this feature?" is `SELECT … WHERE bindingKind='feature' AND bindingId=?` with an index. JSONB requires doc scans or awkward GIN expressions.
- **Entity lifecycle** — when a feature is deleted in Hive, a single query finds all bound nodes to orphan. In JSONB, every doc must be scanned.
- **Matches the library cheaply** — a ~150-line serializer converts rows → `CanvasData`.

Cost we accepted: schema migrations for new node fields. Mitigated by a `props jsonb` column on `CanvasNode` and `CanvasEdge` for renderer hints, flags, and fields that haven't earned a column yet.

If canvases ever become solo-editing whiteboards with no cross-referencing, revisit.

## 12. Open questions

Things we have not decided and will need to before/during implementation:

1. **Initiative as a first-class Hive entity?** Right now narrative-only. When a CEO's initiative is managed for months with its own tasks, does it deserve a Prisma `Initiative` model, or does it stay a canvas node forever? Defaults: stay canvas-only until we feel pain.
2. **File/module nodes.** `canvas:<org>:repo:<id>` is empty until we have a code graph. What's the source (Stakgraph? embeddings? the repo's existing sync pipeline)?
3. **Theme per canvas vs. per org.** Default to org theme; allow per-canvas override via `Canvas.theme`. Is that enough?
4. **Permissions.** Who can edit which canvases? OWNER/ADMIN write root? DEVELOPER writes only inside workspaces they belong to? Agent bound to the calling user's role?
5. **Agent "walking" visualization.** When the agent opens a sub-canvas to investigate, do we show a visual trail on the parent canvas ("agent is inside workspace X")? Could be a breadcrumb or a pulsing node indicator.
6. **Reflow algorithm.** Default layout for auto-seeded nodes: grid? force-directed? hierarchical by binding kind? Start with a simple grouped grid (bound by `bindingKind`, then alphabetized).
7. **Undo.** Row-level mutations mean no free undo. Worth adding `CanvasEvent` append-only log for replay + time travel, or skip?
8. **Cross-canvas edges** — if "mirror nodes" prove clumsy, reconsider true cross-canvas edges in `CanvasEdge`.
9. **Chat ↔ canvas coupling.** When the chat response mentions a bound entity, which canvases should glow? The one currently open? All mirrors? A sidebar indicator?

## 13. Thinnest possible first slice

Once the model feels right, this is the minimum that proves it end-to-end:

1. Prisma models: `Canvas`, `CanvasNode`, `CanvasEdge`. Migrations. Seeder for org root canvas populating workspaces as bound nodes.
2. `GET /api/orgs/:login/canvas?ref=…` returning `CanvasData` + bindings + unplaced.
3. `POST /api/orgs/:login/canvas/mutate` accepting `add_node`, `update_node`, `add_edge`, `delete_*`.
4. Pusher events on the org channel: `canvas:node_added`, `canvas:node_updated`, `canvas:edge_added`, etc.
5. `<OrgCanvas>` component: wraps `<SystemCanvas>`, handles `onResolveCanvas` by fetching child refs, subscribes to Pusher for deltas.
6. Mount in `ConnectionsPage` as the default view (v1 UI).
7. Expose `canvas.add_note` as a single agent tool in `OrgChat`. Prove the loop.

Everything else — promotion, mirrors, reflow, theme overrides, sub-canvas creation, semantic zoom, the mockup layout — is iterative after this slice works.
