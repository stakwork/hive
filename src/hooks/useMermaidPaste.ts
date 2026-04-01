"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { extractMermaidBody } from "@/lib/diagrams/mermaid-parser";
import {
  parseMermaidToParsedDiagram,
  UnsupportedMermaidTypeError,
} from "@/lib/diagrams/mermaid-to-parsed-diagram";
import {
  relayoutDiagram,
  computeUserElementsBoundingBox,
  computePlacementOffset,
  offsetExcalidrawElements,
} from "@/services/excalidraw-layout";
import { tagElementsAsAi } from "@/services/whiteboard-elements";

export interface UseMermaidPasteOptions {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  programmaticUpdateCountRef: React.MutableRefObject<number>;
  saveToDatabase: (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles
  ) => Promise<void>;
  isEnabled: boolean;
}

/**
 * Registers a document-level paste listener that detects Mermaid `graph`/`flowchart`
 * syntax (raw or fenced), converts it to Excalidraw elements via ELK layout, and
 * applies + saves the result to the canvas.
 *
 * Skips paste when a text input, textarea, or contenteditable element is focused.
 */
export function useMermaidPaste({
  excalidrawAPI,
  programmaticUpdateCountRef,
  saveToDatabase,
  isEnabled,
}: UseMermaidPasteOptions): void {
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Guard: skip while AI generation in progress or API not ready
      if (!isEnabled || !excalidrawAPI) return;

      // Guard: skip when a text input is focused (allow normal paste behaviour)
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }

      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;

      // Detect Mermaid syntax — fenced block first, then raw
      const fenced = extractMermaidBody(text);
      let body: string;
      if (fenced !== null) {
        body = fenced;
      } else if (/^(graph|flowchart)[\s\t]/i.test(text.trimStart())) {
        body = text;
      } else {
        return; // Not Mermaid
      }

      // Block Excalidraw's native paste handler immediately
      e.preventDefault();

      // Parse diagram
      let parsed;
      try {
        parsed = parseMermaidToParsedDiagram(body);
      } catch (err) {
        if (err instanceof UnsupportedMermaidTypeError) {
          toast.error("Unsupported diagram type — only flowchart/graph is supported");
        } else {
          toast.error("Invalid Mermaid syntax — could not parse diagram");
        }
        return;
      }

      // Layout via ELK
      let data;
      try {
        data = await relayoutDiagram(parsed, "layered");
      } catch {
        toast.error("Failed to layout diagram");
        return;
      }

      // Tag new elements as AI-generated
      const tagged = tagElementsAsAi(data.elements) as unknown[];

      // Compute placement offset relative to existing content so pasted diagram doesn't overlap
      const existing = Array.from(excalidrawAPI.getSceneElements()) as unknown[];
      const bbox = computeUserElementsBoundingBox(existing);

      let positioned: unknown[];
      if (bbox && tagged.length > 0) {
        const aiMinX = Math.min(...tagged.map((e) => (e as { x: number }).x));
        const aiMinY = Math.min(...tagged.map((e) => (e as { y: number }).y));
        const aiMaxX = Math.max(
          ...tagged.map((e) => (e as { x: number; width: number }).x + (e as { width: number }).width)
        );
        const aiMaxY = Math.max(
          ...tagged.map((e) => (e as { y: number; height: number }).y + (e as { height: number }).height)
        );
        const { offsetX, offsetY } = computePlacementOffset(bbox, aiMaxX - aiMinX, aiMaxY - aiMinY);
        positioned = offsetExcalidrawElements(tagged, offsetX - aiMinX, offsetY - aiMinY);
      } else {
        positioned = tagged;
      }

      // Append new elements — never remove existing content
      const merged = [...existing, ...positioned] as unknown as readonly ExcalidrawElement[];

      // Suppress the onChange save guard for this programmatic update (updateScene + scrollToContent)
      programmaticUpdateCountRef.current += 2;

      // Apply to canvas
      excalidrawAPI.updateScene({ elements: merged });
      excalidrawAPI.scrollToContent(undefined, {
        fitToViewport: true,
        viewportZoomFactor: 0.9,
        animate: true,
        duration: 300,
      });

      // Persist to database
      await saveToDatabase(merged, excalidrawAPI.getAppState(), excalidrawAPI.getFiles());

      const count = parsed.components.length;
      toast.success(`Imported ${count} node${count === 1 ? "" : "s"} from Mermaid diagram`);
    };

    // Use capture phase to intercept before Excalidraw's built-in mermaid paste handler
    document.addEventListener("paste", handlePaste, true);
    return () => document.removeEventListener("paste", handlePaste, true);
  }, [isEnabled, excalidrawAPI, programmaticUpdateCountRef, saveToDatabase]);
}
