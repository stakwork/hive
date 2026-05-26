"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mention model
// ---------------------------------------------------------------------------
//
// The input is a plain `<textarea>`, but mentions are tracked as a separate
// array of `{ id, kind, title, start, end }`. The visual bold styling is
// rendered by a mirrored `<div>` positioned directly behind the textarea
// (Slack/Linear-style).
//
// On submit the consumer extracts ids from `mentions` — we never parse the
// text on the server.
//
// Edits inside a mention range break the mention (it's dropped). Edits
// outside a mention range shift its `start/end` by the diff. Backspace at
// the end of a mention range deletes the whole mention atomically.

export type MentionKind = "feature" | "task";

export interface Mention {
  id: string;
  kind: MentionKind;
  title: string;
  start: number;
  end: number;
}

export interface MentionSuggestion {
  id: string;
  kind: MentionKind;
  title: string;
}

export interface MentionInputHandle {
  focus: () => void;
}

interface MentionInputProps {
  value: string;
  mentions: Mention[];
  onChange: (value: string, mentions: Mention[]) => void;
  onSubmit?: () => void;
  fetchSuggestions: (query: string) => Promise<MentionSuggestion[]>;
  resolveById?: (id: string) => Promise<MentionSuggestion | null>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  textareaClassName?: string;
  rows?: number;
  autoFocus?: boolean;
  "data-testid"?: string;
}

// Matches the substring "@xxx" where xxx is the active mention query.
// `\B` ensures the @ isn't preceded by a word char (so emails like
// "foo@bar" don't trigger). The query allows letters/digits/dash/underscore
// — spaces close the mention popup, matching Slack/Linear behavior. The
// inserted title may contain spaces, but the *typing* query never does.
const MENTION_TRIGGER_RE = /(?:^|\s)@([\w-]*)$/;

// Looks like a cuid (Prisma default ids are `c` + ~24 lowercase alphanum)
// or a UUID. Used to short-circuit the dropdown when the user pastes an id.
function looksLikeId(token: string): boolean {
  return (
    /^c[a-z0-9]{20,}$/i.test(token) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      token,
    )
  );
}

// Shift mention ranges in response to a text edit. Anchored at `editStart`
// (the index where the change began). `delta` is `newLen - oldLen`. Any
// mention whose range overlaps the edit region is dropped (the user typed
// through it). Mentions entirely after the edit slide by `delta`; mentions
// entirely before it are unaffected.
function shiftMentions(
  mentions: Mention[],
  editStart: number,
  editEnd: number, // exclusive index in the OLD value
  delta: number,
): Mention[] {
  const next: Mention[] = [];
  for (const m of mentions) {
    // Fully before edit → keep as-is
    if (m.end <= editStart) {
      next.push(m);
      continue;
    }
    // Fully after edit → shift
    if (m.start >= editEnd) {
      next.push({ ...m, start: m.start + delta, end: m.end + delta });
      continue;
    }
    // Overlapping the edit region → drop (mention is broken)
  }
  return next;
}

// Find the mention whose range ends exactly at `cursor`. Used to detect
// "backspace at end of mention" for atomic delete.
function mentionEndingAt(
  mentions: Mention[],
  cursor: number,
): Mention | undefined {
  return mentions.find((m) => m.end === cursor);
}

// Find the mention whose range starts exactly at `cursor`. Used for
// forward-delete atomic delete.
function mentionStartingAt(
  mentions: Mention[],
  cursor: number,
): Mention | undefined {
  return mentions.find((m) => m.start === cursor);
}

export const MentionInput = forwardRef<MentionInputHandle, MentionInputProps>(
  function MentionInput(
    {
      value,
      mentions,
      onChange,
      onSubmit,
      fetchSuggestions,
      resolveById,
      placeholder,
      disabled,
      className,
      textareaClassName,
      rows = 1,
      autoFocus,
      "data-testid": dataTestId,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    // Mention dropdown state
    const [query, setQuery] = useState<string | null>(null);
    // The index in `value` where the trigger `@` lives (so we know what to
    // replace when the user picks a suggestion).
    const [triggerStart, setTriggerStart] = useState<number>(0);
    const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const [isFetching, setIsFetching] = useState(false);

    // Cancel stale fetches by tracking the latest query token
    const fetchSeq = useRef(0);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    useEffect(() => {
      if (autoFocus) textareaRef.current?.focus();
    }, [autoFocus]);

    // Fetch suggestions when the query changes. Debounced via the
    // sequence counter so out-of-order responses can't clobber newer ones.
    useEffect(() => {
      if (query === null) {
        setSuggestions([]);
        return;
      }
      const seq = ++fetchSeq.current;
      setIsFetching(true);
      fetchSuggestions(query)
        .then((results) => {
          if (seq !== fetchSeq.current) return;
          setSuggestions(results);
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
    }, [query, fetchSuggestions]);

    // Sync overlay scroll with textarea scroll
    const syncScroll = useCallback(() => {
      if (!overlayRef.current || !textareaRef.current) return;
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }, []);

    // Detect when the cursor sits at the tail of an "@…" sequence and open
    // the dropdown. Called from onChange and onSelect/onKeyUp.
    const recomputeMentionQuery = useCallback(
      (text: string, cursor: number) => {
        const before = text.slice(0, cursor);
        const match = before.match(MENTION_TRIGGER_RE);
        if (match) {
          // `match.index` points at the leading char of the full match
          // (which may be a whitespace char or the start of string). The
          // actual `@` is one char in unless the match started at the
          // string start, in which case `@` is at index 0.
          const atIdx = before.lastIndexOf("@");
          setTriggerStart(atIdx);
          setQuery(match[1]);
        } else {
          setQuery(null);
        }
      },
      [],
    );

    const closeMentionPopup = useCallback(() => {
      setQuery(null);
      setSuggestions([]);
      setActiveIndex(0);
    }, []);

    // Insert a chosen suggestion. Replaces "@<query>" at the trigger site
    // with "@<title>" and registers a new Mention. Used by both the
    // autocomplete picker and the paste-by-id resolver.
    const insertMention = useCallback(
      (suggestion: MentionSuggestion, replaceStart: number, replaceEnd: number) => {
        const before = value.slice(0, replaceStart);
        const after = value.slice(replaceEnd);
        const insertedText = `@${suggestion.title}`;
        const newValue = before + insertedText + " " + after;

        // Old replaced span was [replaceStart, replaceEnd); new span is
        // [replaceStart, replaceStart + insertedText.length + 1) (including
        // the trailing space). Compute the diff and shift downstream
        // mentions.
        const oldLen = replaceEnd - replaceStart;
        const newLen = insertedText.length + 1; // +1 for the trailing space
        const delta = newLen - oldLen;

        const shifted = shiftMentions(mentions, replaceStart, replaceEnd, delta);
        const newMention: Mention = {
          id: suggestion.id,
          kind: suggestion.kind,
          title: suggestion.title,
          start: replaceStart,
          end: replaceStart + insertedText.length,
        };
        // Insert preserving sort order by start
        const nextMentions = [...shifted, newMention].sort(
          (a, b) => a.start - b.start,
        );

        onChange(newValue, nextMentions);
        closeMentionPopup();

        // Restore caret to just after the inserted mention + space
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (!ta) return;
          ta.focus();
          const pos = replaceStart + insertedText.length + 1;
          ta.setSelectionRange(pos, pos);
        });
      },
      [value, mentions, onChange, closeMentionPopup],
    );

    // Try to resolve a pasted id token. Called when the user types/pastes
    // text that looks like an id directly after `@`. If resolution succeeds
    // the raw id is replaced with `@<title>`; if it fails we leave the text
    // alone (the user sees their paste survived, no spurious chip).
    const tryResolvePastedId = useCallback(
      async (token: string, atIdx: number, tokenEnd: number) => {
        if (!resolveById) return;
        try {
          const resolved = await resolveById(token);
          if (resolved) {
            insertMention(resolved, atIdx, tokenEnd);
          }
        } catch {
          // Silent failure — the raw text remains
        }
      },
      [resolveById, insertMention],
    );

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        const cursor = e.target.selectionStart ?? newValue.length;

        // Diff against the old value to maintain mention ranges. We only
        // know the cursor position after the edit; assume the edit happened
        // at the contiguous diff span between old and new value, anchored
        // at `cursor` (this handles typing, paste, and most deletes).
        const oldValue = value;
        const delta = newValue.length - oldValue.length;
        // The OLD-value end of the edit region (exclusive) is cursor - delta
        // when delta < 0 (delete), or cursor when delta > 0 (insert). For
        // typed inserts the edit's old-end equals editStart (no chars were
        // replaced); for deletes the old-end is editStart + (-delta).
        let editStart: number;
        let editEnd: number;
        if (delta >= 0) {
          editStart = cursor - delta;
          editEnd = editStart; // inserts have zero-width old range
        } else {
          editStart = cursor;
          editEnd = cursor + -delta;
        }
        // Clamp to valid range
        editStart = Math.max(0, editStart);
        editEnd = Math.max(editStart, editEnd);

        const nextMentions = shiftMentions(mentions, editStart, editEnd, delta);
        onChange(newValue, nextMentions);
        recomputeMentionQuery(newValue, cursor);

        // Detect pasted/typed id immediately after `@`
        const before = newValue.slice(0, cursor);
        const idMatch = before.match(/(?:^|\s)@([\w-]+)$/);
        if (idMatch && looksLikeId(idMatch[1])) {
          const atIdx = before.lastIndexOf("@");
          void tryResolvePastedId(idMatch[1], atIdx, cursor);
        }
      },
      [value, mentions, onChange, recomputeMentionQuery, tryResolvePastedId],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Mention popup navigation takes priority
        if (query !== null && suggestions.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % suggestions.length);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex(
              (i) => (i - 1 + suggestions.length) % suggestions.length,
            );
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const s = suggestions[activeIndex];
            insertMention(s, triggerStart, triggerStart + 1 + (query?.length ?? 0));
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            closeMentionPopup();
            return;
          }
        }

        // Atomic delete: backspace at end of a mention range removes the
        // whole mention in one keystroke. Without this, users would have to
        // backspace through "Automated Stakwork Run Creation..." char by
        // char.
        if (e.key === "Backspace") {
          const ta = textareaRef.current;
          if (!ta) return;
          if (ta.selectionStart !== ta.selectionEnd) return; // selection delete handled normally
          const cursor = ta.selectionStart ?? 0;
          const m = mentionEndingAt(mentions, cursor);
          if (m) {
            e.preventDefault();
            const before = value.slice(0, m.start);
            const after = value.slice(m.end);
            const newValue = before + after;
            const delta = -(m.end - m.start);
            const remaining = mentions
              .filter((x) => x !== m)
              .map((x) =>
                x.start >= m.end
                  ? { ...x, start: x.start + delta, end: x.end + delta }
                  : x,
              );
            onChange(newValue, remaining);
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(m.start, m.start);
            });
            return;
          }
        }
        if (e.key === "Delete") {
          const ta = textareaRef.current;
          if (!ta) return;
          if (ta.selectionStart !== ta.selectionEnd) return;
          const cursor = ta.selectionStart ?? 0;
          const m = mentionStartingAt(mentions, cursor);
          if (m) {
            e.preventDefault();
            const before = value.slice(0, m.start);
            const after = value.slice(m.end);
            const newValue = before + after;
            const delta = -(m.end - m.start);
            const remaining = mentions
              .filter((x) => x !== m)
              .map((x) =>
                x.start >= m.end
                  ? { ...x, start: x.start + delta, end: x.end + delta }
                  : x,
              );
            onChange(newValue, remaining);
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(m.start, m.start);
            });
            return;
          }
        }

        if (e.key === "Enter" && !e.shiftKey && onSubmit) {
          e.preventDefault();
          onSubmit();
          return;
        }
      },
      [
        query,
        suggestions,
        activeIndex,
        triggerStart,
        insertMention,
        closeMentionPopup,
        mentions,
        value,
        onChange,
        onSubmit,
      ],
    );

    // Recompute mention popup state when caret moves without text change
    // (e.g. arrow keys, click). This lets the popup reopen if the user
    // moves the cursor back into an `@…` region.
    const handleSelect = useCallback(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      recomputeMentionQuery(value, ta.selectionStart ?? value.length);
    }, [value, recomputeMentionQuery]);

    // Build the overlay's content: segment `value` into spans, bolding the
    // ranges that lie inside a mention. The overlay matches the textarea's
    // typography exactly so the bold spans align with the underlying text.
    const overlaySegments = useMemo(() => {
      if (mentions.length === 0) {
        return [{ text: value, mention: false, key: "all" }];
      }
      const sorted = [...mentions].sort((a, b) => a.start - b.start);
      const segs: Array<{ text: string; mention: boolean; key: string }> = [];
      let cursor = 0;
      sorted.forEach((m, i) => {
        if (m.start > cursor) {
          segs.push({
            text: value.slice(cursor, m.start),
            mention: false,
            key: `pre-${i}`,
          });
        }
        segs.push({
          text: value.slice(m.start, m.end),
          mention: true,
          key: `m-${i}-${m.id}`,
        });
        cursor = m.end;
      });
      if (cursor < value.length) {
        segs.push({ text: value.slice(cursor), mention: false, key: "tail" });
      }
      return segs;
    }, [value, mentions]);

    return (
      <div className={cn("relative w-full", className)}>
        {/* Mention dropdown */}
        {!disabled && query !== null && (suggestions.length > 0 || isFetching) && (
          <div
            className="absolute bottom-full left-0 right-0 mb-1 z-20"
            data-testid="mention-dropdown"
          >
            <Command className="rounded-lg border shadow-md bg-popover" shouldFilter={false}>
              <CommandList>
                {isFetching && suggestions.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Searching…
                  </div>
                )}
                {suggestions.map((s, idx) => (
                  <CommandItem
                    key={`${s.kind}-${s.id}`}
                    value={`${s.kind}-${s.id}`}
                    onSelect={() =>
                      insertMention(
                        s,
                        triggerStart,
                        triggerStart + 1 + (query?.length ?? 0),
                      )
                    }
                    className={cn(
                      "cursor-pointer px-3 py-2 text-sm",
                      idx === activeIndex && "bg-accent text-accent-foreground",
                    )}
                    data-testid={`mention-item-${s.id}`}
                  >
                    <span className="font-medium truncate">{s.title}</span>
                    <span className="ml-2 text-xs text-muted-foreground uppercase">
                      {s.kind}
                    </span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </div>
        )}

        {/* Visual layer (overlay) + interactive layer (textarea).
            The textarea's text is transparent and its caret stays visible;
            the overlay paints every character, highlighting mention spans.
            For sub-pixel caret alignment the two elements MUST share
            identical text metrics: font-family, font-size, font-weight,
            letter-spacing, line-height, padding, border, and word/whitespace
            wrapping. The `font-inherit` style + `text-base` on both, plus
            keeping mention spans at the SAME font-weight as the textarea
            (using color/background instead of weight to signal "this is a
            mention"), guarantees no glyph-width drift between layers. */}
        <div
          ref={overlayRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words",
            "px-3 py-2 text-sm leading-[1.5] text-foreground",
            // Match textarea's intrinsic word-break behavior. Without this
            // a long unbroken token (like a cuid) wraps differently in the
            // div vs. the textarea, throwing off vertical alignment.
            "[overflow-wrap:break-word]",
            textareaClassName,
          )}
          style={{
            // Force the same font stack as the textarea. Browsers apply
            // their own UA font to <textarea>; here we override both to
            // inherit from the parent, which gives us a single source of
            // truth.
            fontFamily: "inherit",
            fontVariantLigatures: "none",
          }}
        >
          {overlaySegments.map((seg) =>
            seg.mention ? (
              // IMPORTANT: do NOT change font-weight here — bold glyphs in
              // proportional fonts are wider than regular glyphs, which
              // would shift every character after the mention out from
              // under the textarea's caret. Use color + background pill
              // styling to signal "this is a mention".
              <span
                key={seg.key}
                className="rounded bg-primary/10 text-primary"
                data-testid="mention-chip"
              >
                {seg.text}
              </span>
            ) : (
              <span key={seg.key}>{seg.text}</span>
            ),
          )}
          {/* Zero-width char so the overlay's last line keeps height when
              value ends with a newline */}
          {"\u200b"}
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          onSelect={handleSelect}
          onClick={handleSelect}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          data-testid={dataTestId}
          className={cn(
            "relative w-full resize-none bg-transparent",
            "px-3 py-2 text-sm leading-[1.5]",
            "border border-input rounded-md",
            "focus:outline-none focus:ring-2 focus:ring-ring/40",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "[overflow-wrap:break-word]",
            // Placeholder must remain visible — only the typed text is
            // transparent. Tailwind doesn't have a built-in for this so we
            // rely on the `text-transparent` + `placeholder:text-...`
            // combo below.
            "text-transparent placeholder:text-muted-foreground",
            "caret-foreground selection:bg-primary/30 selection:text-foreground",
            textareaClassName,
          )}
          style={{
            // Mirror overlay metrics exactly. Browsers apply a UA font to
            // <textarea> (often the platform default monospace-ish stack);
            // explicitly inheriting forces it to match the div.
            fontFamily: "inherit",
            fontVariantLigatures: "none",
          }}
        />
      </div>
    );
  },
);
