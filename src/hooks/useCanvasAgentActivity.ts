import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

/**
 * Jamie's activity state for the canvas chat header indicator: true
 * while a turn is loading or streaming.
 */
export function useCanvasAgentActivity(
  activeConversationId: string | null,
): { isActive: boolean } {
  // Narrow selectors — only re-render when the specific booleans change
  const isLoading = useCanvasChatStore(
    (s) =>
      (activeConversationId
        ? s.conversations[activeConversationId]?.isLoading
        : false) ?? false,
  );
  const isStreaming = useCanvasChatStore(
    (s) =>
      (activeConversationId
        ? s.conversations[activeConversationId]?.isStreaming
        : false) ?? false,
  );

  return { isActive: isLoading || isStreaming };
}
