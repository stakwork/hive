import { vi } from "vitest";

export const relayoutDiagram = vi.fn().mockResolvedValue({
  elements: [],
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
});
