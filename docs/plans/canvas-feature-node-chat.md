# Canvas Feature-Node Chat

Expose the feature-level "plan chat" (the conversational front-end for the serial-agent planning workflow) inside the org canvas right panel, so the user can read and continue a feature's planning conversation without leaving `/org/[githubLogin]`.

Status: **proposed**.

## Goal

When the user clicks a `feature` node on the org canvas, the right panel's Details tab today shows a status pill, a task count, an optional owner, and an "Open feature" link out to `/w/{slug}/plan/{featureId}` (`NodeDetail.tsx:288-315`). That link is a *teleport*: it leaves the canvas, drops you into a two-pane resizable layout (chat + artifacts panel) with all the workflow trimmings — collaborator presence, project-log streaming, model picker, breadcrumbs, mobile preview swap, etc. (`PlanChatView.tsx:89-651`).

Most of the time the user doesn't need any of that. They want to read the last few messages, ask a quick clarifying question, and stay on the canvas. The plan chat is "simple usually" (per the request) — under the hood it's a complex serial-agent workflow, but the *user-facing* surface is just a chat scroll plus an input.

This plan exposes that conversation as a third section inside the existing feature-node `NodeDetail` body — keyed off the same `/api/features/[featureId]/chat` API the full plan page uses, subscribing to the same Pusher channel for live updates, but rendered as a narrow sidebar chat (the visual idiom already established by `SidebarChat` for canvas-agent conversations). The "Open feature" link stays as the escape hatch to the full artifacts UI.

### One non-negotiable artifact: clarifying questions

The plan agent's signature interaction is the **clarifying-questions card**: when it can't make progress without more info, it emits a structured JSON artifact (a `PLAN`-typed `Artifact` with `tool_use === "ask_clarifying_questions"`) carrying a list of `ClarifyingQuestion` objects. Each question can be free-form text **or** a multiple-choice with optional embedded sub-artifacts (mermaid diagrams, comparison tables, color swatches — see `src/components/features/ClarifyingQuestionsPreview/`). The user answers in the chat and submission posts back via the chat API with a `replyId` pointing at the artifact's message; once answered, the card collapses to an "N questions answered" summary.

This **must** render in the canvas chat. Without it, the workflow halts visibly on the full plan page (artifacts panel shows the questions inline next to the chat) but invisibly on the canvas sidebar — the user sees a one-line "Looking into it…" assistant message and no way to proceed. This isn't a fancy nice-to-have; it's the difference between "the plan agent works on the canvas" and "the plan agent silently stalls and the user thinks something's broken."

Good news: the renderer (`<ClarifyingQuestionsPreview>`) and the answer-submission contract (`onArtifactAction` → `POST /api/features/[id]/chat` with `replyId`) both already exist and are reusable as-is. The work is wiring them through the new sidebar component without dragging in the rest of `ChatMessage`. See "Clarifying questions — required artifact rendering" below.

## Non-goals

- **Showing PLAN/TASKS/VERIFY artifacts inline as the artifact body.** That's the multi-tab content rendered by `ArtifactsPanel` next to the chat on the full plan page (the actual brief / requirements / architecture / user-story sections, the task list, the verify checklist). Out of scope for this PR — see "Follow-up: artifacts dialog" below. **Exception:** clarifying-questions are themselves a `PLAN` artifact and *do* render inline; see the dedicated section below. The other `PLAN`-content shapes (the structured plan-section payload, the `TASKS` payload, etc.) are skipped — the user gets a "Full plan view" link instead.
- **Editing the feature title from the canvas.** `PlanChatView` has an inline title editor; the canvas already shows the feature title at the top of `NodeDetail` (from the canvas projector data) and changing titles from a node-detail context is a separate UX question.
- **Collaborator presence / typing indicators.** `usePlanPresence` exists, but presence on a peripheral surface adds noise. Skip it; the full plan page is where collaboration happens.
- **Live project-log streaming (`useProjectLogWebSocket`).** The "thinking logs" stream is a debug/observability surface tied to the artifacts panel's run-status display. The sidebar chat shows assistant messages and the workflow status — that's enough.
- **Model picker.** Sends use the persisted `feature.model` (set from the full plan page). No selector in the sidebar.
- **Image/file attachments.** The sidebar input is keyboard-only.
- **Mobile.** The org canvas is desktop-only; the feature-node chat inherits that constraint.
- **Showing the chat for non-feature nodes.** Tasks have their own conversation (`/w/{slug}/tasks/{taskId}`) which is a different beast. This PR is scoped to `case "feature"` in `NodeDetail`. Tasks could follow the same pattern in a follow-up if there's demand.
- **Replacing or modifying `PlanChatView`.** The full plan page stays exactly as it is. No shared hook extraction, no layout-neutral refactor — the new component reads the same API but is its own narrow-column shape.
- **Reusing `ChatArea` from the task page.** `ChatArea` (`src/app/w/[slug]/task/[...taskParams]/components/ChatArea.tsx`) is 441 lines of breadcrumbs, back-buttons, invite popovers, release-pod confirms, title editing, mobile preview toggles — none of which fit the canvas sidebar. Forking is cheaper than threading another half-dozen "hide this in canvas mode" props.

## The chrome we're adding

```
┌──────────────────────────────────────┐
│ FEATURE                              │
│ Improve onboarding flow              │
├──────────────────────────────────────┤
│ ● in_progress     7 tasks            │
│ ┌────────────────┬────────────────┐  │
│ │ Owner          │ Alice          │  │
│ └────────────────┴────────────────┘  │
│ ↗ Open feature                       │
│                                      │
│ ─── Plan chat ──────────────────     │
│ ┌────────────────────────────────┐   │
│ │ Assistant: Here's a brief…     │   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ User: tighten step 2           │   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ ▶ Workflow: in_progress…       │   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ Ask the planner…           [→] │   │
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘
```

The existing feature `KindExtras` block (status pill, task count, owner, "Open feature" link) is unchanged. Below it: a short divider and the `FeaturePlanChat` component.

The right panel stays at `w-96` (set by `canvas-sidebar-chat`). No layout change to `OrgRightPanel`. No new tab.

## Routing

Unchanged. The chat lives inside the existing Details tab body, only when `selectedNode.id` resolves to a feature (via the `case "feature"` arm in `KindExtras`). No new routes, no deep-link param. To get a permalink to a specific feature's chat, the canvas already supports node-selection deep links via the canvas pane.

## Files changed

| File | Change |
| ---- | ------ |
| `src/app/org/[githubLogin]/_components/FeaturePlanChat.tsx` | **New.** ~300 lines. Sidebar-shaped chat for feature nodes. Reads/writes `/api/features/[featureId]/chat`, subscribes to Pusher via `usePusherConnection({ featureId })`, pairs reply messages with their artifact messages, handles regular sends and clarifying-question answer submissions. |
| `src/app/org/[githubLogin]/_components/FeaturePlanChatMessage.tsx` | **New.** ~120 lines. Narrow-column message bubble for `ChatMessage` (the feature/task chat type). Renders text content; renders `<ClarifyingQuestionsPreview>` or `<AnsweredClarifyingQuestions>` for `PLAN` artifacts with `tool_use === "ask_clarifying_questions"`; renders nothing for other artifact types in PR 1 (with an optional "View N artifacts" pill). |
| `src/components/features/ClarifyingQuestionsPreview/AnsweredClarifyingQuestions.tsx` | **New.** ~30 lines. Lifted from `ChatMessage.tsx:71-103`. Renders the collapsible "N questions answered" Q&A summary. Imported by both `FeaturePlanChatMessage` and (refactored) `ChatMessage`. |
| `src/app/w/[slug]/task/[...taskParams]/components/ChatMessage.tsx` | Replace the inline `AnsweredClarifyingQuestions` definition (lines 71-103) with an import from the shared file. ~5-line diff. |
| `src/app/org/[githubLogin]/_components/NodeDetail.tsx` | In `case "feature"` (`NodeDetail.tsx:288-315`), render `<FeaturePlanChat featureId={detail.id} workspaceSlug={slug} />` below the existing stats + "Open feature" link. ~5-line diff. |
| *(recommended)* `src/app/api/orgs/[githubLogin]/canvas/node/[liveId]/route.ts` | Add `workflowStatus: true` to the feature `select` block (line 207-216) and surface as `extras.workflowStatus`. Saves a per-mount `/api/features/[id]` round-trip. ~2-line diff. |

No DB migrations. No new endpoints — the feature chat API (`GET`/`POST /api/features/[featureId]/chat`) already enforces workspace membership (`route.ts:54-64, 127-129`) and is reused as-is. Pusher channels are reused.

## `FeaturePlanChat` — the new component

Lives at `src/app/org/[githubLogin]/_components/FeaturePlanChat.tsx`. Scoped to the feature-node body of the org-canvas Details tab.

### Props

```ts
interface FeaturePlanChatProps {
  /** Feature id (Prisma `Feature.id`). Drives the chat fetch + Pusher channel. */
  featureId: string;
  /**
   * Workspace slug the feature belongs to. Pulled from
   * `detail.extras.workspaceSlug` in `NodeDetail`'s feature arm
   * (`NodeDetail.tsx:291`); same value used to build the
   * "Open feature" footer link.
   */
  workspaceSlug: string;
}
```

That's the entire prop surface. No collaborators, no model list, no `onTitleSave`, no `streamContext`, no `isPrototypeTask`. The plan-page concerns stay on the plan page.

### Layout (root → leaves)

```tsx
<div className="flex flex-col gap-2 mt-4 pt-4 border-t">
  <div className="flex items-center justify-between">
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
      Plan chat
    </span>
    <WorkflowStatusBadge status={workflowStatus} />
  </div>

  {/* Message list — capped height, scrolls internally. */}
  <div ref={scrollRef} className="max-h-[420px] overflow-y-auto rounded border bg-muted/20 p-2">
    {loading ? (
      <Spinner />
    ) : messages.length === 0 ? (
      <EmptyHint>The planner hasn't said anything yet. Send a message to start.</EmptyHint>
    ) : (
      <div className="space-y-2">
        {messages.map((m) => (
          <FeaturePlanChatMessage key={m.id} message={m} />
        ))}
        {workflowStatus === WorkflowStatus.IN_PROGRESS && <ToolCallIndicator … />}
      </div>
    )}
  </div>

  {/* Input — keyboard only. */}
  <FeaturePlanChatInput onSend={handleSend} disabled={inputDisabled} />

  <div className="text-[10px] text-muted-foreground italic">
    Full plan view (PLAN/TASKS/VERIFY) →{" "}
    <Link href={`/w/${workspaceSlug}/plan/${featureId}`} className="underline">
      Open feature
    </Link>
  </div>
</div>
```

Bound height (`max-h-[420px]`) on the scroller — the parent `NodeDetail` body is `overflow-y-auto` (`NodeDetail.tsx:64`), and we don't want a runaway message list to push the rest of the details body below the fold. Internal scroll keeps the stats visible.

The "Open feature" link inside `FeaturePlanChat` is a *secondary* footer specifically pointing the user at the artifacts panel ("Full plan view"); the existing primary "Open feature" link in `KindExtras` remains. Two links is fine — they have different framing.

### Reused dependencies

- `SidebarChatMessage` (`src/app/org/[githubLogin]/_components/SidebarChatMessage.tsx`) — the narrow-column message bubble already used by `SidebarChat`. **Drop-in.** Need to verify its props match `ChatMessage` (the type used by `/api/features/[featureId]/chat`); see "Type-shape gotcha" below.
- `ToolCallIndicator` (`@/components/dashboard/DashboardChat/ToolCallIndicator`) — same component used by `SidebarChat`. Used here only when `workflowStatus === IN_PROGRESS` and the most recent assistant message hasn't streamed text yet (mirrors `PlanChatView`'s implicit pattern via `ChatArea`).
- `usePusherConnection` (`@/hooks/usePusherConnection`) — already keyed by `featureId` (`usePusherConnection.ts:62-77`). We pass `onMessage`, `onWorkflowStatusUpdate`. **Skip** `onFeatureUpdated`, `onFeatureTitleUpdate` — title/brief refresh is handled by the canvas projector when the user hits the canvas next; we don't need to refetch the node detail from inside the chat.
- `useSession` — to attach `createdBy` on the optimistic user message.

### State

```ts
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [loading, setLoading] = useState(true);     // initial GET
const [sending, setSending] = useState(false);    // POST in flight
const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
const scrollRef = useRef<HTMLDivElement>(null);
```

That's it. No project-id tracking (no live-log subscription), no sphinx-ready, no LLM-models-list, no presence, no diff highlights, no `initialLoadDone` two-stage gate (we use `loading` directly), no tab state, no localStorage.

### Initial fetch

```ts
useEffect(() => {
  let cancelled = false;
  setLoading(true);
  fetch(`/api/features/${featureId}/chat`)
    .then((r) => (r.ok ? r.json() : { data: [] }))
    .then((body) => {
      if (cancelled) return;
      setMessages(body.data ?? []);
      // Workflow status is on the feature row, not the chat.
      // Cheap second fetch — or pull from props if we expose it via the
      // canvas node API. See "Workflow status source" below.
    })
    .catch(() => {})
    .finally(() => {
      if (!cancelled) setLoading(false);
    });
  return () => { cancelled = true; };
}, [featureId]);
```

Mount-only effect (deps stable). On error, falls through to "no messages" — the user can still try sending one.

### Pusher subscription

```ts
usePusherConnection({
  featureId,
  onMessage: (msg) => {
    setMessages((prev) =>
      prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
    );
    setSending(false);
  },
  onWorkflowStatusUpdate: (u) => {
    setWorkflowStatus(u.workflowStatus);
    if (
      u.workflowStatus === WorkflowStatus.COMPLETED ||
      u.workflowStatus === WorkflowStatus.FAILED ||
      u.workflowStatus === WorkflowStatus.ERROR ||
      u.workflowStatus === WorkflowStatus.HALTED
    ) {
      setSending(false);
    }
  },
});
```

Same pattern as `PlanChatView.tsx:329-369`, minus the title-update / feature-update / log subscription branches. The hook's `enabled` defaults to `true`; when `NodeDetail` switches to a non-feature node, `FeaturePlanChat` unmounts entirely, which the hook handles by disconnecting on cleanup.

### `handleSend`

Adapt from `PlanChatView.tsx:371-426`:

```ts
const handleSend = async (text: string) => {
  const optimistic = createChatMessage({
    id: generateUniqueId(),
    message: text,
    role: ChatRole.USER,
    status: ChatStatus.SENDING,
    createdBy: session?.user ? { /* … */ } : undefined,
  });
  setMessages((m) => [...m, optimistic]);
  setSending(true);
  setWorkflowStatus(WorkflowStatus.IN_PROGRESS);

  try {
    const res = await fetch(`/api/features/${featureId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        sourceWebsocketID: getPusherClient().connection.socket_id,
        // No `model` — server falls back to feature.model (already persisted).
      }),
    });
    if (!res.ok) throw new Error("send failed");
    const data = await res.json();
    setMessages((m) =>
      m.map((x) => (x.id === optimistic.id ? { ...data.message, status: ChatStatus.SENT } : x)),
    );
  } catch (e) {
    setMessages((m) =>
      m.map((x) => (x.id === optimistic.id ? { ...x, status: ChatStatus.ERROR } : x)),
    );
    setSending(false);
  }
};
```

Drop from `PlanChatView`'s version: `attachments`, `selectedModel`, `clearLogs`, `setProjectId`, `setIsChainVisible`. Don't pass `replyId` — the Approve/Reject artifact actions live on the full plan page.

### `inputDisabled`

```ts
const inputDisabled = loading || sending || workflowStatus === WorkflowStatus.IN_PROGRESS;
```

Mirrors `PlanChatView.tsx:516-520` minus the `feature.status === "CANCELLED"` clause (we don't have the feature row here; if it's worth surfacing, the canvas API can include `extras.status` which already does — `NodeDetail.tsx:289`).

### Auto-scroll

```ts
useEffect(() => {
  const el = scrollRef.current;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}, [messages, workflowStatus]);
```

Same `scrollTop = scrollHeight` pattern `SidebarChat` uses (`SidebarChat.tsx:69-73`). Avoids the `scrollIntoView` page-bumping risk that `ChatArea` runs into (and partially mitigates with `shouldAutoScroll` state).

## Clarifying questions — required artifact rendering

The plan agent's `ask_clarifying_questions` flow is the most user-facing artifact in the feature chat and the **one** artifact type the canvas sidebar must render in PR 1. Skipping it would leave the agent unable to make progress whenever it needs input — a silent stall that's worse than not exposing the chat at all.

### How the existing flow works

1. **Agent emits.** During a Stakwork run, the agent attaches a `PLAN`-typed `Artifact` to the latest assistant `ChatMessage` whose `content` is a `ClarifyingQuestionsResponse` shape (`{ tool_use: "ask_clarifying_questions", content: ClarifyingQuestion[] }`). The artifact streams in via Pusher; the message's `artifacts` array gains a new entry. Detection is via `isClarifyingQuestions(a.content)` from `@/types/stakwork` (`ChatMessage.tsx:16-17`).
2. **Each `ClarifyingQuestion`** is one of:
   - **Free-form text** — render a `<Textarea>`.
   - **Multiple-choice** — render a list of options (radio or checkbox). Optional `artifact` field embedded in the question carries a mermaid diagram, comparison table, or color-swatch grid that helps the user choose. Validation lives in `ClarifyingQuestionsPreview/index.tsx:16-100`.
3. **User answers.** `<ClarifyingQuestionsPreview>` collects responses, formats them as a Q&A block (one `Q: …\nA: …` per pair, separated by blank lines), and calls `onSubmit(formattedAnswers)`.
4. **Submit.** The host component (today: `ChatMessage`) receives `onSubmit` and turns it into an `onArtifactAction(message.id, { actionType: "button", optionLabel: "Submit", optionResponse: formattedAnswers }, "")` call (`ChatMessage.tsx:349-358`).
5. **POST.** The host's `onArtifactAction` (today: `PlanChatView.handleArtifactAction` at `PlanChatView.tsx:428-488`) POSTs to `/api/features/[featureId]/chat` with `{ message: optionResponse, replyId: messageId, model: selectedModel }`. The server creates a new USER message linked back to the artifact's message via `replyId`, kicks off the next workflow step, and Pusher streams the next assistant turn.
6. **Render after answer.** Once a USER message with `replyId === artifactMessage.id` exists, `<ClarifyingQuestionsPreview>` is replaced by `<AnsweredClarifyingQuestions>` — a collapsible "N questions answered" Q&A summary computed from `parseQAPairs(replyMessage.message)` (`ChatMessage.tsx:71-103`). The original artifact + answer message stay in the conversation as a record.

### What `FeaturePlanChat` needs to do

Three integration points:

#### 1. Pair reply messages with their artifact messages

`ChatArea` does this today at `ChatArea.tsx:375-384`:

```ts
.filter((msg) => !msg.replyId)              // hide reply messages from the top-level list
.map((msg) => {
  const replyMessage = messages.find((m) => m.replyId === msg.id);
  return <ChatMessage … replyMessage={replyMessage} />;
});
```

`FeaturePlanChat`'s render loop adopts the same two-step shape: filter out `replyId`-bearing messages from the top-level scroll, then for each remaining message look up its reply in the original list and pass it to the message renderer. Same pattern, different bubble component.

#### 2. Render the artifact inside `FeaturePlanChatMessage`

The fork called out in "Type-shape gotcha" above gets one more responsibility: detect clarifying-questions artifacts on the message and render them inline. Roughly:

```tsx
import { isClarifyingQuestions } from "@/types/stakwork";
import type { ClarifyingQuestionsResponse } from "@/types/stakwork";
import { ClarifyingQuestionsPreview } from "@/components/features/ClarifyingQuestionsPreview";

// inside FeaturePlanChatMessage, after rendering the bubble text:
{message.artifacts
  ?.filter((a) => a.type === "PLAN" && isClarifyingQuestions(a.content))
  .map((artifact) => {
    const questions = (artifact.content as ClarifyingQuestionsResponse).content;
    const isAnswered = !!replyMessage;
    return (
      <div key={artifact.id} className="w-full">
        {isAnswered && replyMessage ? (
          <AnsweredClarifyingQuestions questions={questions} replyMessage={replyMessage} />
        ) : (
          <ClarifyingQuestionsPreview
            questions={questions}
            onSubmit={(formattedAnswers) =>
              onSubmitAnswers(message.id, formattedAnswers)
            }
          />
        )}
      </div>
    );
  })}
```

`<AnsweredClarifyingQuestions>` is a small (~30 line) component that we copy-paste from `ChatMessage.tsx:71-103`. It's tied to the Q&A summary format, not to any task/feature-specific concern; safe to lift into `FeaturePlanChat.tsx` as a sibling. Alternatively: extract it into `src/components/features/ClarifyingQuestionsPreview/AnsweredClarifyingQuestions.tsx` so both `ChatMessage` and `FeaturePlanChatMessage` can import it. Recommendation: extract it (one shared file, two callers, ~5 line refactor on the `ChatMessage` side). Keeps the rendering of "answered" state consistent if the design ever evolves.

#### 3. Submit answers via the same `replyId` POST

`FeaturePlanChat` adds an `onSubmitAnswers(messageId, answers)` callback that mirrors `PlanChatView.handleArtifactAction` minus the model picker:

```ts
const onSubmitAnswers = async (messageId: string, formattedAnswers: string) => {
  const optimistic = createChatMessage({
    id: generateUniqueId(),
    message: formattedAnswers,
    role: ChatRole.USER,
    status: ChatStatus.SENDING,
    replyId: messageId,
    createdBy: session?.user ? { /* … */ } : undefined,
  });
  setMessages((m) => [...m, optimistic]);
  setSending(true);
  setWorkflowStatus(WorkflowStatus.IN_PROGRESS);

  try {
    const res = await fetch(`/api/features/${featureId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: formattedAnswers,
        replyId: messageId,
        sourceWebsocketID: getPusherClient().connection.socket_id,
      }),
    });
    if (!res.ok) throw new Error("submit failed");
    const data = await res.json();
    setMessages((m) =>
      m.map((x) => (x.id === optimistic.id ? { ...data.message, status: ChatStatus.SENT } : x)),
    );
  } catch {
    setMessages((m) =>
      m.map((x) => (x.id === optimistic.id ? { ...x, status: ChatStatus.ERROR } : x)),
    );
    setSending(false);
  }
};
```

Same shape as the regular `handleSend`, plus `replyId: messageId` in both the optimistic message and the POST body. The two paths can share a single internal helper (`sendInternal({ text, replyId? })`) to halve the duplication.

### Embedded sub-artifacts in narrow columns

`<ClarifyingQuestionsPreview>` already supports embedded mermaid diagrams, comparison tables, and color swatches inside multiple-choice options. Mermaid in particular wants width — it's a chart. In a 384px sidebar column, the embedded artifact will render at column width, which mermaid handles via SVG scaling but comparison tables can run into horizontal scroll on dense data. Acceptable as-is in PR 1: the user can always click "Open feature" if a question's table is unreadable. If feedback later says it's too cramped, the mitigation is a "View at full width" button that opens the artifact in a modal — small follow-up, not a launch blocker.

### What the chat does while a clarifying-questions artifact is pending

Two states matter:

- **Pending answer (no reply message exists yet):** The agent's workflow is paused waiting for input. `workflowStatus` should be `IN_PROGRESS` (the Stakwork run is still alive, waiting on the user). The text input below the message list **should remain enabled** so the user can either answer via the card *or* type a free-form response — sometimes users prefer to ignore the structured form and just say "skip these, use defaults" or "actually let me re-explain the goal." This matches the full plan page's behavior (the input isn't disabled while questions are pending).
- **After answer (reply message exists):** Card collapses to `<AnsweredClarifyingQuestions>`. `workflowStatus` flips back to `IN_PROGRESS` from the answer POST and follows the normal flow.

Reconciling this with `inputDisabled` (which today is `loading || sending || workflowStatus === IN_PROGRESS`): the `IN_PROGRESS` clause is too aggressive when there's a pending clarifying question. Refinement:

```ts
const hasPendingClarifyingQuestion = useMemo(
  () =>
    messages.some(
      (m) =>
        m.artifacts?.some(
          (a) => a.type === "PLAN" && isClarifyingQuestions(a.content),
        ) &&
        !messages.some((reply) => reply.replyId === m.id),
    ),
  [messages],
);

const inputDisabled =
  loading ||
  sending ||
  (workflowStatus === WorkflowStatus.IN_PROGRESS && !hasPendingClarifyingQuestion);
```

When `hasPendingClarifyingQuestion` is true, the input stays enabled even though the workflow is technically running.

### Tests for clarifying questions

Add to the unit test list:

- Renders `<ClarifyingQuestionsPreview>` when an assistant message has a `PLAN` artifact with `tool_use === "ask_clarifying_questions"` and no reply message exists.
- Renders `<AnsweredClarifyingQuestions>` (collapsible Q&A summary) when a reply message with `replyId === artifactMessageId` exists.
- Reply messages (`replyId` set) are filtered out of the top-level message scroll.
- Submitting answers via the preview's `onSubmit` POSTs to `/api/features/[id]/chat` with `replyId` set and `message` equal to the formatted Q&A string.
- After submit, optimistic user message has `replyId` set on its row, status `SENDING`; on Pusher confirmation it flips to `SENT`.
- `inputDisabled` is `false` while a clarifying-questions artifact is pending answer, even when `workflowStatus === IN_PROGRESS`.
- `inputDisabled` is `true` while `workflowStatus === IN_PROGRESS` and **no** pending clarifying question exists.

Mocking strategy: mock `<ClarifyingQuestionsPreview>` to expose a button that calls its `onSubmit` prop with a known string, then assert the resulting POST body. This is exactly what `ChatMessage.test.tsx:90-95` does.

## Workflow status source

Two options for hydrating `workflowStatus` on initial mount:

1. **Add it to `NodeDetail`'s feature `extras`.** Edit `src/app/api/orgs/[githubLogin]/canvas/node/[liveId]/route.ts:207-217`'s `select` to include `workflowStatus`, then surface it via `extras.workflowStatus`. `NodeDetail`'s feature arm already destructures `extras` and would pass it down to `<FeaturePlanChat />`. Cheap.
2. **Second fetch from `FeaturePlanChat`.** Hit `/api/features/${featureId}` (the same endpoint `useDetailResource` uses in `PlanChatView.tsx:162-167`). Slower but doesn't touch the canvas API.

**Recommendation: option 1.** The canvas API is already enriching feature `extras` (status, priority, taskCount, etc.); adding `workflowStatus` is one column on the existing select clause. The Pusher subscription will then keep it live.

## Type-shape gotcha — `ChatMessage` vs `CanvasChatMessage`

`SidebarChat` renders `CanvasChatMessage` (the canvas-chat-store type, defined in `src/app/org/[githubLogin]/_state/canvasChatStore.ts`). `FeaturePlanChat` renders `ChatMessage` (the feature/task chat type, from `@/lib/chat`). They overlap (`id`, `role`, `content`/`message`, `createdBy`) but **the field names diverge** — task/feature chat uses `message: string` and `role: ChatRole` (an enum), canvas chat uses `content: string` and `role: "user" | "assistant"`.

`SidebarChatMessage` is hard-coded to `CanvasChatMessage` (`SidebarChatMessage.tsx:18`). Two clean options:

1. **Make `SidebarChatMessage` polymorphic.** Accept a normalized prop shape (`{ id, role: "user" | "assistant", content: string, status?, createdBy? }`) and have both call sites pass normalized data. The canvas-chat-store path is already trivially mappable; the feature-chat path needs a one-liner adapter.
2. **Fork into `FeaturePlanChatMessage`.** ~60 lines, no logic. Same bubble styling, types `ChatMessage`. No coupling between the two surfaces.

**Recommendation: option 2.** The two chat systems have legitimately different message shapes (artifacts on the feature side, tool-calls + proposals on the canvas side, different `createdBy` contracts) and squeezing them through one component will create conditional rendering knots as artifact types grow. Forking now is cheaper than refactoring later. ~60 line cost, scoped to one file — plus the clarifying-questions render block detailed in the next section, which lives inside this fork.

If a later PR ports the canvas chat onto Prisma's `ChatMessage` model (the open question raised at the end of `canvas-sidebar-chat.md`), revisit.

## Auth surface

The feature chat API already enforces workspace-membership reads (`route.ts:54-64`) and writes (`route.ts:127-129`). Calling it from `FeaturePlanChat` inherits those checks for free — there's nothing to add. A user viewing the canvas of an org they have access to **may not** have membership in every workspace inside that org; if they don't, the GET will 404/403 and the chat will render empty + the input will fail. That's correct behavior.

The `feature` node arm in `NodeDetail` is reachable for any feature node the org canvas projects, which today are the same set the user can access (the projector is org-scoped via `sourceControlOrgId`). Cross-tenant leakage isn't a new risk this PR introduces.

## `NodeDetail` integration

In `NodeDetail.tsx:288-315`, the feature `case` becomes:

```diff
 case "feature": {
   const status = (extras.status ?? "") as string;
   const taskCount = Number(extras.taskCount ?? 0);
   const slug = extras.workspaceSlug as string | undefined;
   const assignee = extras.assignee as
     | { name: string | null }
     | null
     | undefined;
   return (
     <div className="space-y-3">
       <div className="flex items-center gap-2 flex-wrap">
         {status && <StatusPill value={status} />}
         <span className="text-xs text-muted-foreground">
           {taskCount} task{taskCount === 1 ? "" : "s"}
         </span>
       </div>
       {assignee?.name && (
         <StatGrid stats={[{ label: "Owner", value: assignee.name }]} />
       )}
       {slug && (
         <FooterLink
           href={`/w/${slug}/plan/${detail.id}`}
           label="Open feature"
         />
       )}
+      {slug && (
+        <FeaturePlanChat
+          featureId={detail.id}
+          workspaceSlug={slug}
+        />
+      )}
     </div>
   );
 }
```

`slug` is required (it's how the chat bubbles a "Full plan view" link); if it's missing for some reason, we degrade to the existing details body without the chat.

The feature chat is gated on `slug` being present — never gated on a load state, because `FeaturePlanChat` owns its own `loading` state and renders its own spinner inside the bordered container.

## Tests

Light. Most behavior is covered by the existing feature-chat tests in `PlanChatView`-adjacent code; the new component is a thin re-skin of the same fetch+Pusher pattern.

### Unit (Vitest, `src/__tests__/unit/`)

- `FeaturePlanChat.test.tsx`:
  - Renders spinner while initial GET is pending.
  - Renders messages from `GET /api/features/[id]/chat` response.
  - Renders empty hint when API returns `[]`.
  - Sends a message: optimistic user bubble appears immediately, POST fires with `message` + `sourceWebsocketID`, no `model`/`replyId`/`attachments`.
  - On POST 500, the optimistic message flips to `ChatStatus.ERROR` and `inputDisabled` releases.
  - When `usePusherConnection`'s `onMessage` fires with a new id, message appears; with a duplicate id, it's a no-op.
  - When `usePusherConnection`'s `onWorkflowStatusUpdate` fires `COMPLETED`, `inputDisabled` releases.
  - `inputDisabled` is `true` while `workflowStatus === IN_PROGRESS`.
  - "Full plan view" link points at `/w/{slug}/plan/{featureId}`.
- `NodeDetail.test.tsx` (extend existing if present, else new):
  - Feature node detail body renders `<FeaturePlanChat />` when `extras.workspaceSlug` is present.
  - Doesn't render `<FeaturePlanChat />` when `extras.workspaceSlug` is missing.
  - Non-feature node detail bodies (initiative, milestone, task) don't render any chat.

Mock `usePusherConnection` to return `{ isConnected: true, ... }` and capture the callbacks so tests can fire `onMessage`/`onWorkflowStatusUpdate` synchronously.

### Integration

Out of scope for PR 1. The full plan page integration tests already cover the chat round-trip end-to-end; we'd add Playwright coverage for the canvas embed in a follow-up if it's worth the runtime.

## Implementation plan

One PR. Roughly 250 lines of new component + a 5-line edit to `NodeDetail` + an optional 1-line edit to the canvas node API.

### Step 1 — Extract `AnsweredClarifyingQuestions` to a shared file

- New: `src/components/features/ClarifyingQuestionsPreview/AnsweredClarifyingQuestions.tsx`. Copy lines 71-103 of `ChatMessage.tsx` (the component + the `parseQAPairs` helper at lines 20-30) verbatim. Export `AnsweredClarifyingQuestions` (named) and `parseQAPairs` (named, in case other surfaces want it).
- Edit `ChatMessage.tsx` to import from the new file and delete the local copies. Verify task page chat still renders the answered card identically.
- Run `npm run test:unit -- ChatMessage` to confirm no regression.

### Step 2 — Add `workflowStatus` to canvas node `extras`

- Edit `src/app/api/orgs/[githubLogin]/canvas/node/[liveId]/route.ts:207-216`'s `select` block to add `workflowStatus: true`.
- Add `workflowStatus: feat.workflowStatus` to the `extras` object at lines 227-233.
- That's it. (Skippable, but the alternative is a per-mount `/api/features/[id]` round-trip in `FeaturePlanChat`.)

### Step 3 — Build `FeaturePlanChatMessage`

- New: `src/app/org/[githubLogin]/_components/FeaturePlanChatMessage.tsx`. ~120 lines.
- Props: `{ message: ChatMessage, replyMessage?: ChatMessage, onSubmitAnswers: (messageId: string, answers: string) => Promise<void> }`.
- Render the message text bubble (right-aligned for `role === USER`, left-aligned otherwise, mirroring `SidebarChatMessage`'s narrow-column treatment).
- After the bubble, render the clarifying-questions block: `message.artifacts?.filter((a) => a.type === "PLAN" && isClarifyingQuestions(a.content))` → either `<ClarifyingQuestionsPreview>` (no `replyMessage`) or `<AnsweredClarifyingQuestions>` (has `replyMessage`).
- Optional: a small `View N artifacts →` pill for messages with non-clarifying artifacts, linking to `/w/{slug}/plan/{featureId}`. Cheap addition; helps discoverability without rendering complexity.
- Skip everything `ChatMessage.tsx` does that we don't need: form artifacts, longform, publish-workflow, bounty, pull-request, image attachments, file attachments, workflow URL link, image enlargement dialog. The fork is small precisely because we're not porting any of that.

### Step 4 — Build `FeaturePlanChat` in isolation

- New: `src/app/org/[githubLogin]/_components/FeaturePlanChat.tsx`. ~300 lines.
- Adapt initial-fetch + Pusher + `handleSend` from `PlanChatView` per the strip list above.
- Add `onSubmitAnswers` (clarifying-question answer submission) — share an internal `sendInternal({ text, replyId? })` helper between it and `handleSend` to avoid duplicating the optimistic-message + POST + error-handling logic.
- Implement message dedup on `onMessage` (`messages.some((m) => m.id === msg.id) ? prev : [...prev, msg]`).
- Implement reply-message pairing: filter out `m.replyId`-bearing messages from the top-level scroll, then pass each top-level message + its lookup-result as `replyMessage` to `<FeaturePlanChatMessage>`.
- Compute `hasPendingClarifyingQuestion` per the spec above; refine `inputDisabled` to keep the input enabled when a clarifying question is awaiting answer.
- Implement `scrollTop = scrollHeight` auto-scroll keyed on `messages` and `workflowStatus`.
- Don't wire it into `NodeDetail` yet. Drop it temporarily into a story or render it directly under `KindExtras` for visual QA. Test specifically: a feature whose latest workflow run paused on clarifying questions (set up by sending an ambiguous prompt to the full plan page first).

### Step 5 — Wire into `NodeDetail`

- Edit `NodeDetail.tsx`'s `case "feature"` arm per the diff above.
- Verify the existing feature node's stats render unchanged when there's no chat history (the most common case for newly-created features).

### Step 6 — Manual QA

On `/org/[githubLogin]`:

- Click a feature node with existing plan messages — chat populates, scroll is at bottom, "Open feature" + "Full plan view" links both work.
- Click a feature node with no plan messages — empty hint renders, input is enabled.
- Send a message — optimistic bubble appears, workflow status flips to `IN_PROGRESS`, input disables, streamed assistant messages append, status flips back to `COMPLETED`, input re-enables.
- **Clarifying-questions flow:** Send an ambiguous prompt that the agent will follow up on with `ask_clarifying_questions`. Wait for the artifact to stream in. Verify:
  - `<ClarifyingQuestionsPreview>` renders inline below the assistant message.
  - The text input below stays **enabled** (doesn't lock out free-form responses while the question is pending).
  - Multiple-choice questions with embedded mermaid/comparison-table/color-swatch sub-artifacts render at column width without horizontal-scroll surprises.
  - Submit answers; optimistic user message (with `replyId` set) appears, status flips to `IN_PROGRESS`, the preview collapses to `<AnsweredClarifyingQuestions>` (collapsible, click to expand and see Q&A pairs).
  - The next assistant message streams in via Pusher.
- Open the same feature in a second tab via the full plan page (`/w/{slug}/plan/{featureId}`); answer the clarifying questions there. Verify the canvas tab's preview swaps to `<AnsweredClarifyingQuestions>` automatically (Pusher delivers the reply message; the pairing logic finds it).
- Open the same feature in two tabs (canvas + full plan). Send a message from one. Verify both receive the assistant response via Pusher.
- Click a non-feature node (initiative, repo, task, note) — no chat renders, only existing details.
- Click a feature node, then click another feature node — chat unmounts and remounts, messages refetch, no stale Pusher subscription bleeding through (the hook handles cleanup).
- Click a feature node, then click the canvas (deselect) — `NodeDetail` unmounts, `FeaturePlanChat` unmounts, Pusher disconnects.
- Click "Full plan view" — navigates to `/w/{slug}/plan/{featureId}`. Verify the conversation matches what was visible in the sidebar.

### Step 7 — Cleanup

- `npm run lint` + `npx tsc --noEmit` + `npm run test:unit`.
- No doc-file updates needed beyond this plan; `NodeDetail`'s top-level docstring (`NodeDetail.tsx:10-24`) explains the live/authored split — the chat is a third concern but a small one. If we want to flag it explicitly, add one line to the docstring noting that feature nodes also surface a plan-chat sub-component.

## Follow-up: artifacts dialog

The user asked about exposing the PLAN/TASKS/VERIFY artifact tabs (the three-tab pane that lives next to the chat in `PlanChatView`) inside a modal launched from the canvas, so that **the user can do all their work without leaving the canvas**. Tracking this as explicit follow-up scope, not in this PR:

- `<ArtifactsPanel>` is already self-contained — it accepts `artifacts`, `planData`, `feature`, `featureId`, `controlledTab`, `onControlledTabChange`, `sectionHighlights`, `onFeatureUpdate` (`PlanChatView.tsx:590-601`). It's plausibly liftable into a `Dialog` with the right hooks wrapping it.
- A "Plan view" button next to the "Full plan view" link in `FeaturePlanChat` would open a large modal containing `<ArtifactsPanel>`, fetching the same feature data the full plan page does (`useDetailResource`).
- The hard parts: (1) `useModal` (`src/components/modals/ModlaProvider.tsx`) is the existing imperative modal launcher; the artifacts panel would need to fit inside its layout primitives. (2) The PR/diff janitors plus the section-highlights diff effect (`computeSectionHighlights` at `PlanChatView.tsx:62-81`) are presence-aware and stateful — they'd need a `prev`/`next` ref to behave the same in a modal. (3) Mobile mode is a non-issue (canvas is desktop) but the modal sizing rules need attention.
- Schema impact: none. The existing `/api/features/[id]` + `/api/features/[id]/user-stories` + Pusher endpoints already cover everything the modal would need.

If/when we ship it, the canvas becomes the user's home base for the entire planning surface — chat in the right rail, artifacts in a launched dialog, feature-graph context permanently visible behind. That's the destination. This PR is the first step.

## Risks

- **`SidebarChatMessage` doesn't render `ChatMessage` (the feature-chat type) cleanly.** Mitigation: fork `FeaturePlanChatMessage` per "Type-shape gotcha" above. ~60 lines.
- **Pusher channel collision.** Two components subscribing to the same `featureId` channel — the canvas's `FeaturePlanChat` and the full plan page's `PlanChatView` — should be fine; Pusher fans out events to all bound listeners. Verify in QA: open both surfaces in different tabs, send from one, confirm both receive.
- **Workflow `IN_PROGRESS` state can stick.** If the workflow errors mid-run and Pusher misses the terminal status update, `inputDisabled` could stay `true` forever. The full plan page has the same risk — punt mitigation to whatever it currently does (or doesn't). Worth a manual test: kill a workflow mid-run on the full page, watch the canvas tab — does it eventually unstick?
- **Empty-state scroll height.** With no messages, the bordered container collapses to its padding. Acceptable; the empty hint fills it.
- **Long messages overflow horizontally.** `SidebarChatMessage` has the same risk and `SidebarChat` survives. The fork above inherits whatever wrapping `SidebarChatMessage` does today (assumed `whitespace-pre-wrap break-words`).
- **Non-clarifying `PLAN`/`TASKS`/`VERIFY` artifact content on individual messages.** Feature chat messages can carry the structured plan-section, task-list, or verify-checklist artifacts; the sidebar is intentionally not rendering them as full bodies in this PR. Mitigation: a small "View N artifacts →" pill that links to the full plan page (preserves discoverability without the rendering complexity). One-line addition to `FeaturePlanChatMessage`.
- **Embedded sub-artifacts in clarifying questions render too narrow.** A mermaid diagram or comparison table inside a 384px column may be unreadable for dense data. Mitigation: ship as-is in PR 1; "Open feature" link is the safety valve. If feedback warrants it, follow-up PR adds an "expand" affordance that opens the sub-artifact in a modal at full width.
- **Pending clarifying question gets orphaned across sessions.** If the user closes the canvas tab while a clarifying-questions card is rendered without answering, then later returns, the artifact and the un-answered state both reload from the API correctly (server is the source of truth). The `hasPendingClarifyingQuestion` memo recomputes from `messages` on every render, so the input stays enabled on rehydration. Verify in QA: open canvas, hit ambiguous prompt, refresh tab while card is up — card should still be there, input still enabled.
- **Two surfaces submit the same answer simultaneously.** If the user has both the canvas chat and the full plan page open and clicks Submit on both within milliseconds, two reply messages with the same `replyId` may be created. The server doesn't currently dedup on `replyId` (verified informally — `services/roadmap/feature-chat` doesn't appear to enforce uniqueness). Low risk in practice (humans can't double-submit faster than network latency); deferred to a server-side `replyId` uniqueness constraint if it ever surfaces.
- **`AnsweredClarifyingQuestions` extraction breaks the task page.** Step 1 lifts the inline component into a shared file. Mitigation: run `npm run test:unit -- ChatMessage` after the extraction; visual-QA an answered task-chat clarifying-questions card before merging.
