"use client";

/**
 * Reusable mention-range tracking + suggestion-menu behavior, extracted
 * from `components/logs-chat/MentionInput.tsx` so a plain, already-wired
 * `<textarea>` (autosize, paste-image handling, voice input, IME) can gain
 * structured `@mention` support WITHOUT being replaced by the full
 * `MentionInput` component (see `SidebarChatInput` in
 * `app/org/[githubLogin]/_components/SidebarChat.tsx` — workflow
 * mentions).
 *
 * Mentions are tracked as a side array of `{ id, name, start, end }` ranges
 * into the plain string value — never parsed back out of the text. Two
 * edit paths keep ranges accurate:
 *
 *   - `onChange` (a real `<textarea>` change event): the edit region is
 *     anchored at the reported cursor position — precise for typing,
 *     paste, and IME composition commits.
 *   - `applyExternalValue` (a value set OUTSIDE a change event — e.g. a
 *     voice-transcript effect that calls `setInput` directly): no cursor
 *     is available, so the edit region is recovered via a longest-common-
 *     prefix / longest-common-suffix diff against the last known value.
 *
 * Either path: any mention whose range overlaps the edited region is
 * dropped (its text changed underneath it — a broken mention is worse
 * than no mention); mentions entirely outside it shift by the exact
 * length delta.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

export interface RangeMention {
  id: string;
  name: string;
  start: number;
  end: number;
}

export interface MentionRangeSuggestion {
  id: string;
  name: string;
}

// Matches the substring "@xxx" where xxx is the active mention query,
// mirroring `MentionInput`'s trigger. `\B` ensures the `@` isn't preceded
// by a word char (so "foo@bar" never triggers), and the query never
// contains whitespace — a space closes the menu.
const MENTION_TRIGGER_RE = /(?:^|\s)@([\w-]*)$/;

function lcpLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

function lcsLen(a: string, b: string, prefixLen: number): number {
  const max = Math.min(a.length, b.length) - prefixLen;
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Shift/drop mention ranges for an edit spanning `[editStart, editEnd)`
 * in the OLD value, whose new length differs by `delta`. Mentions fully
 * before the edit are untouched; fully after are shifted by `delta`;
 * anything overlapping is dropped.
 */
function shiftRanges<T extends { start: number; end: number }>(
  ranges: T[],
  editStart: number,
  editEnd: number,
  delta: number,
): T[] {
  const next: T[] = [];
  for (const r of ranges) {
    if (r.end <= editStart) {
      next.push(r);
      continue;
    }
    if (r.start >= editEnd) {
      next.push({ ...r, start: r.start + delta, end: r.end + delta });
      continue;
    }
    // Overlapping the edit region — the mention's underlying text may
    // have changed; drop it rather than risk a stale/incorrect range.
  }
  return next;
}

/** A mention is only safe to submit if its range still spells `@name`. */
export function filterValidMentions(text: string, mentions: RangeMention[]): RangeMention[] {
  return mentions.filter((m) => text.slice(m.start, m.end) === `@${m.name}`);
}

export interface UseMentionRangesOptions {
  value: string;
  mentions: RangeMention[];
  onChange: (value: string, mentions: RangeMention[]) => void;
  fetchSuggestions: (query: string) => Promise<MentionRangeSuggestion[]>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  maxSuggestions?: number;
  debounceMs?: number;
  disabled?: boolean;
}

export interface UseMentionRangesResult {
  /** Active mention query text (post-`@`), or `null` when the menu is closed. */
  query: string | null;
  suggestions: MentionRangeSuggestion[];
  isFetching: boolean;
  activeIndex: number;
  isMenuOpen: boolean;
  /** Wire to the textarea's `onChange`, alongside (or instead of) your own. */
  handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  /** Wire to the textarea's `onKeyDown`. Returns `true` when the event was
   *  consumed (menu nav, atomic mention delete) — the caller should stop
   *  processing (e.g. skip its own Enter-to-send) when this is `true`. */
  handleKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Wire to `onSelect`/`onClick` so moving the caret back into an `@…`
   *  span re-opens the menu. */
  handleSelect: () => void;
  /** Click/keyboard selection of a suggestion. */
  selectSuggestion: (s: MentionRangeSuggestion) => void;
  closeMenu: () => void;
  /**
   * Apply a value change that did NOT come through the textarea's own
   * `onChange` (e.g. a voice-transcript effect calling `setInput`
   * directly). Diffs against the last known value via longest-common-
   * prefix/suffix and shifts/drops mentions accordingly.
   */
  applyExternalValue: (newValue: string) => void;
  /** Ranges whose visible text still matches `@name` — safe to submit. */
  getValidMentions: () => RangeMention[];
}

export function useMentionRanges(opts: UseMentionRangesOptions): UseMentionRangesResult {
  const {
    value,
    mentions,
    onChange,
    fetchSuggestions,
    textareaRef,
    maxSuggestions = 5,
    debounceMs = 200,
    disabled = false,
  } = opts;

  const [query, setQuery] = useState<string | null>(null);
  const [triggerStart, setTriggerStart] = useState(0);
  const [suggestions, setSuggestions] = useState<MentionRangeSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFetching, setIsFetching] = useState(false);

  const fetchSeq = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeMenu = useCallback(() => {
    setQuery(null);
    setSuggestions([]);
    setActiveIndex(0);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (disabled) closeMenu();
  }, [disabled, closeMenu]);

  // Debounced fetch on query change; stale responses discarded via seq.
  useEffect(() => {
    if (query === null || disabled) {
      setSuggestions([]);
      return;
    }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const seq = ++fetchSeq.current;
    debounceTimer.current = setTimeout(() => {
      setIsFetching(true);
      fetchSuggestions(query)
        .then((results) => {
          if (seq !== fetchSeq.current) return;
          setSuggestions(results.slice(0, maxSuggestions));
          setActiveIndex(0);
        })
        .catch(() => {
          if (seq !== fetchSeq.current) return;
          setSuggestions([]);
        })
        .finally(() => {
          if (seq !== fetchSeq.current) return;
          setIsFetching(false);
        });
    }, debounceMs);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, disabled, debounceMs, maxSuggestions]);

  const recomputeQuery = useCallback((text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const match = before.match(MENTION_TRIGGER_RE);
    if (match) {
      setTriggerStart(before.lastIndexOf("@"));
      setQuery(match[1]);
    } else {
      setQuery(null);
    }
  }, []);

  const insertMention = useCallback(
    (suggestion: MentionRangeSuggestion, replaceStart: number, replaceEnd: number) => {
      const before = value.slice(0, replaceStart);
      const after = value.slice(replaceEnd);
      const insertedText = `@${suggestion.name}`;
      const newValue = `${before}${insertedText} ${after}`;

      const oldLen = replaceEnd - replaceStart;
      const newLen = insertedText.length + 1; // + trailing space
      const delta = newLen - oldLen;

      const shifted = shiftRanges(mentions, replaceStart, replaceEnd, delta);
      const next: RangeMention = {
        id: suggestion.id,
        name: suggestion.name,
        start: replaceStart,
        end: replaceStart + insertedText.length,
      };
      const nextMentions = [...shifted, next].sort((a, b) => a.start - b.start);

      onChange(newValue, nextMentions);
      closeMenu();

      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        const pos = replaceStart + insertedText.length + 1;
        ta.setSelectionRange(pos, pos);
      });
    },
    [value, mentions, onChange, closeMenu, textareaRef],
  );

  const selectSuggestion = useCallback(
    (s: MentionRangeSuggestion) => {
      insertMention(s, triggerStart, triggerStart + 1 + (query?.length ?? 0));
    },
    [insertMention, triggerStart, query],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursor = e.target.selectionStart ?? newValue.length;
      const oldValue = value;
      const delta = newValue.length - oldValue.length;

      // Edit region anchored at the reported cursor: for an insert
      // (delta >= 0) the old-value edit span is zero-width at
      // `cursor - delta`; for a delete it's `[cursor, cursor - delta)`.
      let editStart: number;
      let editEnd: number;
      if (delta >= 0) {
        editStart = cursor - delta;
        editEnd = editStart;
      } else {
        editStart = cursor;
        editEnd = cursor - delta;
      }
      editStart = Math.max(0, editStart);
      editEnd = Math.max(editStart, editEnd);

      const nextMentions = shiftRanges(mentions, editStart, editEnd, delta);
      onChange(newValue, nextMentions);
      recomputeQuery(newValue, cursor);
    },
    [value, mentions, onChange, recomputeQuery],
  );

  const applyExternalValue = useCallback(
    (newValue: string) => {
      const oldValue = value;
      if (newValue === oldValue) return;
      const prefixLen = lcpLen(oldValue, newValue);
      const suffixLen = lcsLen(oldValue, newValue, prefixLen);
      const editStart = prefixLen;
      const editEnd = oldValue.length - suffixLen;
      const delta = newValue.length - oldValue.length;
      const nextMentions = shiftRanges(mentions, editStart, Math.max(editStart, editEnd), delta);
      onChange(newValue, nextMentions);
      // External updates (voice) don't carry a cursor; close any open
      // menu rather than guess a trigger position.
      closeMenu();
    },
    [value, mentions, onChange, closeMenu],
  );

  const handleSelect = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    recomputeQuery(value, ta.selectionStart ?? value.length);
  }, [value, recomputeQuery, textareaRef]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!disabled && query !== null && suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % suggestions.length);
          return true;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectSuggestion(suggestions[activeIndex]);
          return true;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeMenu();
          return true;
        }
      }

      // Atomic delete: Backspace/Delete at a mention's edge removes the
      // whole mention in one keystroke, regardless of menu state.
      const ta = textareaRef.current;
      if (ta && ta.selectionStart === ta.selectionEnd && (e.key === "Backspace" || e.key === "Delete")) {
        const cursor = ta.selectionStart ?? 0;
        const m =
          e.key === "Backspace"
            ? mentions.find((x) => x.end === cursor)
            : mentions.find((x) => x.start === cursor);
        if (m) {
          e.preventDefault();
          const before = value.slice(0, m.start);
          const after = value.slice(m.end);
          const newValue = before + after;
          const delta = -(m.end - m.start);
          const remaining = mentions
            .filter((x) => x !== m)
            .map((x) => (x.start >= m.end ? { ...x, start: x.start + delta, end: x.end + delta } : x));
          onChange(newValue, remaining);
          requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(m.start, m.start);
          });
          return true;
        }
      }

      return false;
    },
    [disabled, query, suggestions, activeIndex, selectSuggestion, closeMenu, mentions, value, onChange, textareaRef],
  );

  const getValidMentions = useCallback(() => filterValidMentions(value, mentions), [value, mentions]);

  return {
    query,
    suggestions,
    isFetching,
    activeIndex,
    isMenuOpen: !disabled && query !== null && (suggestions.length > 0 || isFetching),
    handleChange,
    handleKeyDown,
    handleSelect,
    selectSuggestion,
    closeMenu,
    applyExternalValue,
    getValidMentions,
  };
}
