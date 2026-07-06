"use client";

/**
 * Forks an existing org-canvas conversation into a brand-new,
 * independent `shared_conversations` row owned by the current user.
 *
 * Algorithm:
 * 1. GET the source conversation's raw `messages` + `settings`.
 * 2. POST a new row with those messages + settings (`isShared: false`,
 *    caller as owner) — the fork. `followUpQuestions` and
 *    `provenanceData` are intentionally NOT copied (POST hardcodes them).
 * 3. Hydrate raw messages → `CanvasChatMessage[]`.
 * 4. Seed the store via `startConversation`, linking the fork row as
 *    `serverConversationId` and noting the source as `forkedFromShareId`.
 * 5. Return the fork's `SharedConversation.id`.
 *
 * Authorization: the GET-one route enforces org membership + owner-or-isShared,
 * so a second org member viewing a shared `?chat=` link can fork the source.
 * The POST route independently validates org membership and sets the caller as owner.
 *
 * No-re-save guarantee: `persistCanvasUserMessage` appends only the current
 * turn to the `conversationId` row, and autosave is live-sync/Pusher only.
 * `ephemeralSeedCount = hydrated.length` signals the autosave machinery to
 * skip the copied history on first save, consistent with the automation-inbox
 * pattern in `useAutomationInbox.ts`.
 */

import {
  useCanvasChatStore,
  type CanvasChatMessage,
} from "./canvasChatStore";

export async function forkCanvasConversation(
  githubLogin: string,
  sourceServerId: string,
): Promise<string> {
  // ── 1. Fetch source conversation ─────────────────────────────────────
  const getRes = await fetch(
    `/api/orgs/${githubLogin}/chat/conversations/${sourceServerId}`,
  );
  if (!getRes.ok) {
    throw new Error(
      `Failed to read source conversation (${getRes.status})`,
    );
  }
  const sourceConv = await getRes.json();

  const rawMessages: unknown[] = Array.isArray(sourceConv.messages)
    ? sourceConv.messages
    : [];
  const settings = sourceConv.settings ?? {};

  // ── 2. Create the fork ───────────────────────────────────────────────
  const postRes = await fetch(
    `/api/orgs/${githubLogin}/chat/conversations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: rawMessages,
        settings,
        source: "org-canvas",
      }),
    },
  );
  if (!postRes.ok) {
    throw new Error(`Failed to create fork (${postRes.status})`);
  }
  const { id: forkId } = await postRes.json();

  // ── 3. Hydrate raw messages → CanvasChatMessage[] ────────────────────
  // Mirrors the mapping in useAutomationInbox.ts / CanvasHistoryPopover
  // intentionally — extracting a shared helper is optional cleanup.
  const hydrated: CanvasChatMessage[] = rawMessages
    .filter(
      (m): m is Record<string, unknown> =>
        !!m &&
        typeof m === "object" &&
        ((m as { role?: string }).role === "user" ||
          (m as { role?: string }).role === "assistant"),
    )
    .map((m, idx) => ({
      id: (m.id as string) || `fork-${idx}`,
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
      timestamp: m.timestamp ? new Date(m.timestamp as string) : new Date(),
      toolCalls: m.toolCalls as CanvasChatMessage["toolCalls"],
      timeline: m.timeline as CanvasChatMessage["timeline"],
      artifactIds: m.artifactIds as string[] | undefined,
      attachments: m.attachments as CanvasChatMessage["attachments"],
      approval: m.approval as CanvasChatMessage["approval"],
      rejection: m.rejection as CanvasChatMessage["rejection"],
      approvalResult: m.approvalResult as CanvasChatMessage["approvalResult"],
      deferredCheck: m.deferredCheck as CanvasChatMessage["deferredCheck"],
      source: m.source as CanvasChatMessage["source"],
    }));

  // ── 4. Seed the store ────────────────────────────────────────────────
  const store = useCanvasChatStore.getState();
  const activeId = store.activeConversationId;
  const context = activeId
    ? store.conversations[activeId]?.context
    : undefined;

  const resolvedContext: Parameters<typeof store.startConversation>[0] =
    context ?? {
      orgId: "",
      githubLogin,
      workspaceSlug: null,
      workspaceSlugs: settings?.extraWorkspaceSlugs ?? [],
      currentCanvasRef: "",
      currentCanvasBreadcrumb: "",
      selectedNodeId: null,
      selectedNodeIds: [],
    };

  store.startConversation(
    resolvedContext,
    hydrated,
    sourceServerId, // forkedFromShareId
    hydrated.length, // ephemeralSeedCount — skip re-persisting copied history
    forkId,         // serverConversationId — bind directly to the fork row
  );

  // ── 5. Return fork id ────────────────────────────────────────────────
  return forkId;
}
