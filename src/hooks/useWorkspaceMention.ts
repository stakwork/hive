import { useCallback, useMemo, useState } from "react";

export interface MentionWorkspace {
  slug: string;
  name?: string | null;
}

export interface MentionInsertResult {
  text: string;
  caret: number;
}

const MENTION_TRIGGER_RE = /\B@([\w-]*)$/;

/** Returns the @query being typed immediately before the caret, or null. */
export function detectMentionQuery(text: string, caret: number): string | null {
  const match = text.slice(0, caret).match(MENTION_TRIGGER_RE);
  return match ? match[1] : null;
}

/** Replaces the @query before the caret with "@<slug> ". */
export function applyMention(text: string, caret: number, slug: string): MentionInsertResult {
  const before = text.slice(0, caret).replace(MENTION_TRIGGER_RE, `@${slug}`);
  const after = text.slice(caret);
  return { text: `${before} ${after}`, caret: before.length + 1 };
}

export function filterMentionWorkspaces<T extends MentionWorkspace>(
  workspaces: T[],
  query: string,
  excludeSlug?: string,
): T[] {
  const q = query.toLowerCase();
  return workspaces.filter(
    (ws) =>
      ws.slug !== excludeSlug &&
      (ws.slug.toLowerCase().includes(q) || (ws.name ?? "").toLowerCase().includes(q)),
  );
}

interface Options<T extends MentionWorkspace> {
  workspaces: T[];
  excludeSlug?: string;
  enabled?: boolean;
  onInsert: (result: MentionInsertResult) => void;
}

export function useWorkspaceMention<T extends MentionWorkspace>({
  workspaces,
  excludeSlug,
  enabled = true,
  onInsert,
}: Options<T>) {
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(
    () => (query !== null ? filterMentionWorkspaces(workspaces, query, excludeSlug) : []),
    [workspaces, query, excludeSlug],
  );
  const isOpen = enabled && query !== null && matches.length > 0;

  const close = useCallback(() => {
    setQuery(null);
    setActiveIndex(0);
  }, []);

  /** Call from the input's onChange with the new text and caret position. */
  const update = useCallback((text: string, caret: number) => {
    setQuery(detectMentionQuery(text, caret));
    setActiveIndex(0);
  }, []);

  const select = useCallback(
    (slug: string, text: string, caret: number) => {
      onInsert(applyMention(text, caret, slug));
      close();
    },
    [onInsert, close],
  );

  /** Call first from onKeyDown. Returns true if the event was consumed. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, text: string, caret: number): boolean => {
      if (!isOpen) return false;
      const idx = Math.min(activeIndex, matches.length - 1);
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % matches.length);
          return true;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
          return true;
        case "Tab":
          e.preventDefault();
          select(matches[idx].slug, text, caret);
          return true;
        case "Enter":
          if (e.shiftKey) return false;
          e.preventDefault();
          select(matches[idx].slug, text, caret);
          return true;
        case "Escape":
          e.preventDefault();
          close();
          return true;
        default:
          return false;
      }
    },
    [isOpen, activeIndex, matches, select, close],
  );

  return { isOpen, matches, activeIndex, setActiveIndex, update, select, close, handleKeyDown };
}
