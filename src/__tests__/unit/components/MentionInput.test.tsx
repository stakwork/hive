import React, { useState } from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MentionInput,
  type Mention,
  type MentionSuggestion,
} from "@/components/logs-chat/MentionInput";

// jsdom does not implement scrollIntoView; cmdk calls it internally
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

// ---------------------------------------------------------------------------
// Test harness: wraps MentionInput with the controlled state shape the
// component expects. Exposes the latest value/mentions via `getState()` and
// optional `onSubmit` so tests can assert the contract surface.
// ---------------------------------------------------------------------------

function Harness({
  suggestions,
  resolveById,
  onSubmit,
  initialValue = "",
  initialMentions = [],
}: {
  suggestions: MentionSuggestion[];
  resolveById?: (id: string) => Promise<MentionSuggestion | null>;
  onSubmit?: () => void;
  initialValue?: string;
  initialMentions?: Mention[];
}) {
  const [value, setValue] = useState(initialValue);
  const [mentions, setMentions] = useState<Mention[]>(initialMentions);

  // Static suggestion list filtered by `query` (case-insensitive title
  // substring), mirroring the real fetcher's contract.
  const fetchSuggestions = async (query: string) => {
    const q = query.toLowerCase();
    return suggestions.filter((s) => s.title.toLowerCase().includes(q));
  };

  return (
    <>
      <MentionInput
        value={value}
        mentions={mentions}
        onChange={(v, m) => {
          setValue(v);
          setMentions(m);
        }}
        onSubmit={onSubmit}
        fetchSuggestions={fetchSuggestions}
        resolveById={resolveById}
        placeholder="ask"
        data-testid="mi"
      />
      {/* Mirror of state for assertion. Using data attrs avoids re-render
          coupling to the textarea's value (overlay handles styling, the
          textarea value is the source of truth). */}
      <pre data-testid="state-value">{value}</pre>
      <pre data-testid="state-mentions">{JSON.stringify(mentions)}</pre>
    </>
  );
}

const SUGGESTIONS: MentionSuggestion[] = [
  {
    id: "feat_abc",
    kind: "feature",
    title: "Automated Stakwork Run Creation & Enum Expansion",
  },
  { id: "feat_xyz", kind: "feature", title: "Auth Redesign" },
  { id: "task_123", kind: "task", title: "Fix login redirect" },
];

describe("MentionInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("autocomplete dropdown", () => {
    test("typing @ opens the dropdown with all suggestions", async () => {
      render(<Harness suggestions={SUGGESTIONS} />);
      const ta = screen.getByTestId("mi");
      await userEvent.type(ta, "@");
      // Wait for async fetch to resolve
      await waitFor(() =>
        expect(screen.getByTestId("mention-item-feat_abc")).toBeInTheDocument(),
      );
      expect(screen.getByTestId("mention-item-feat_xyz")).toBeInTheDocument();
      expect(screen.getByTestId("mention-item-task_123")).toBeInTheDocument();
    });

    test("typing @auto narrows to matching feature", async () => {
      render(<Harness suggestions={SUGGESTIONS} />);
      const ta = screen.getByTestId("mi");
      await userEvent.type(ta, "@auto");
      await waitFor(() =>
        expect(screen.getByTestId("mention-item-feat_abc")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("mention-item-feat_xyz")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mention-item-task_123")).not.toBeInTheDocument();
    });

    test("clicking a suggestion inserts the full title + registers a mention", async () => {
      render(<Harness suggestions={SUGGESTIONS} />);
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      await userEvent.type(ta, "@auto");
      await waitFor(() =>
        expect(screen.getByTestId("mention-item-feat_abc")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByTestId("mention-item-feat_abc"));

      await waitFor(() => {
        expect(screen.getByTestId("state-value").textContent).toBe(
          "@Automated Stakwork Run Creation & Enum Expansion ",
        );
      });

      const mentions = JSON.parse(
        screen.getByTestId("state-mentions").textContent || "[]",
      );
      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: "feat_abc",
        kind: "feature",
        title: "Automated Stakwork Run Creation & Enum Expansion",
        start: 0,
      });
      expect(mentions[0].end).toBe(
        "@Automated Stakwork Run Creation & Enum Expansion".length,
      );
    });

    test("Tab inserts the highlighted suggestion", async () => {
      render(<Harness suggestions={SUGGESTIONS} />);
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      await userEvent.type(ta, "@auth");
      await waitFor(() =>
        expect(screen.getByTestId("mention-item-feat_xyz")).toBeInTheDocument(),
      );
      fireEvent.keyDown(ta, { key: "Tab" });
      await waitFor(() => {
        expect(screen.getByTestId("state-value").textContent).toBe(
          "@Auth Redesign ",
        );
      });
    });

    test("Escape dismisses the dropdown", async () => {
      render(<Harness suggestions={SUGGESTIONS} />);
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      await userEvent.type(ta, "@auto");
      await waitFor(() =>
        expect(screen.getByTestId("mention-item-feat_abc")).toBeInTheDocument(),
      );
      fireEvent.keyDown(ta, { key: "Escape" });
      expect(screen.queryByTestId("mention-item-feat_abc")).not.toBeInTheDocument();
    });

    test("ArrowDown moves active highlight and Enter inserts the highlighted item", async () => {
      render(<Harness suggestions={SUGGESTIONS} />);
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      await userEvent.type(ta, "@");
      await waitFor(() =>
        expect(screen.getByTestId("mention-item-feat_abc")).toBeInTheDocument(),
      );
      fireEvent.keyDown(ta, { key: "ArrowDown" });
      fireEvent.keyDown(ta, { key: "Enter" });
      await waitFor(() => {
        expect(screen.getByTestId("state-value").textContent).toBe(
          "@Auth Redesign ",
        );
      });
    });
  });

  describe("paste-by-id resolution", () => {
    test("typing a cuid after @ resolves via resolveById and replaces with the title", async () => {
      const resolveById = vi.fn(async (id: string) => {
        if (id === "ckxabcdefghijklmnopqrstuv") {
          return {
            id,
            kind: "feature" as const,
            title: "Resolved Feature",
          };
        }
        return null;
      });

      render(
        <Harness suggestions={SUGGESTIONS} resolveById={resolveById} />,
      );
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;

      // Simulate a paste: type the @ + the id in one go
      await userEvent.type(ta, "@ckxabcdefghijklmnopqrstuv");

      await waitFor(() => {
        expect(resolveById).toHaveBeenCalledWith("ckxabcdefghijklmnopqrstuv");
      });
      await waitFor(() => {
        expect(screen.getByTestId("state-value").textContent).toBe(
          "@Resolved Feature ",
        );
      });
      const mentions = JSON.parse(
        screen.getByTestId("state-mentions").textContent || "[]",
      );
      expect(mentions).toHaveLength(1);
      expect(mentions[0].id).toBe("ckxabcdefghijklmnopqrstuv");
    });

    test("unresolved id leaves the raw text in place (no spurious chip)", async () => {
      const resolveById = vi.fn(async () => null);
      render(
        <Harness suggestions={SUGGESTIONS} resolveById={resolveById} />,
      );
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      await userEvent.type(ta, "@ckxabcdefghijklmnopqrstuv");
      await waitFor(() =>
        expect(resolveById).toHaveBeenCalled(),
      );
      expect(screen.getByTestId("state-value").textContent).toBe(
        "@ckxabcdefghijklmnopqrstuv",
      );
      expect(
        JSON.parse(screen.getByTestId("state-mentions").textContent || "[]"),
      ).toHaveLength(0);
    });
  });

  describe("atomic delete", () => {
    test("Backspace at end of a mention removes the entire mention", async () => {
      // Start with one mention pre-registered: "@Auth Redesign "
      const initialValue = "@Auth Redesign ";
      const initialMentions: Mention[] = [
        {
          id: "feat_xyz",
          kind: "feature",
          title: "Auth Redesign",
          start: 0,
          end: "@Auth Redesign".length,
        },
      ];
      render(
        <Harness
          suggestions={SUGGESTIONS}
          initialValue={initialValue}
          initialMentions={initialMentions}
        />,
      );
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      ta.focus();
      // Place caret at the end of the mention (just before the trailing space)
      act(() => {
        ta.setSelectionRange(initialMentions[0].end, initialMentions[0].end);
      });
      fireEvent.keyDown(ta, { key: "Backspace" });
      await waitFor(() => {
        expect(screen.getByTestId("state-value").textContent).toBe(" ");
      });
      expect(
        JSON.parse(screen.getByTestId("state-mentions").textContent || "[]"),
      ).toHaveLength(0);
    });

    test("Delete at start of a mention removes the entire mention", async () => {
      const initialValue = "@Auth Redesign x";
      const initialMentions: Mention[] = [
        {
          id: "feat_xyz",
          kind: "feature",
          title: "Auth Redesign",
          start: 0,
          end: "@Auth Redesign".length,
        },
      ];
      render(
        <Harness
          suggestions={SUGGESTIONS}
          initialValue={initialValue}
          initialMentions={initialMentions}
        />,
      );
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      ta.focus();
      act(() => {
        ta.setSelectionRange(0, 0);
      });
      fireEvent.keyDown(ta, { key: "Delete" });
      await waitFor(() => {
        expect(screen.getByTestId("state-value").textContent).toBe(" x");
      });
      expect(
        JSON.parse(screen.getByTestId("state-mentions").textContent || "[]"),
      ).toHaveLength(0);
    });
  });

  describe("range tracking", () => {
    test("typing before a mention shifts its range", async () => {
      const initialValue = "@Auth Redesign ";
      const initialMentions: Mention[] = [
        {
          id: "feat_xyz",
          kind: "feature",
          title: "Auth Redesign",
          start: 0,
          end: "@Auth Redesign".length,
        },
      ];
      render(
        <Harness
          suggestions={SUGGESTIONS}
          initialValue={initialValue}
          initialMentions={initialMentions}
        />,
      );
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      ta.focus();
      // Insert at caret position 0
      act(() => {
        ta.setSelectionRange(0, 0);
      });
      // userEvent.type respects the current caret
      await userEvent.type(ta, "Why ", { initialSelectionStart: 0 });

      await waitFor(() => {
        expect(screen.getByTestId("state-value").textContent).toBe(
          "Why @Auth Redesign ",
        );
      });
      const mentions = JSON.parse(
        screen.getByTestId("state-mentions").textContent || "[]",
      );
      expect(mentions).toHaveLength(1);
      expect(mentions[0].start).toBe(4);
      expect(mentions[0].end).toBe(4 + "@Auth Redesign".length);
    });
  });

  describe("submit", () => {
    test("Enter without modifier calls onSubmit", async () => {
      const onSubmit = vi.fn();
      render(<Harness suggestions={SUGGESTIONS} onSubmit={onSubmit} />);
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      await userEvent.type(ta, "hello");
      fireEvent.keyDown(ta, { key: "Enter" });
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    test("Enter while dropdown is open does NOT submit", async () => {
      const onSubmit = vi.fn();
      render(<Harness suggestions={SUGGESTIONS} onSubmit={onSubmit} />);
      const ta = screen.getByTestId("mi") as HTMLTextAreaElement;
      await userEvent.type(ta, "@auto");
      await waitFor(() =>
        expect(screen.getByTestId("mention-item-feat_abc")).toBeInTheDocument(),
      );
      fireEvent.keyDown(ta, { key: "Enter" });
      // Enter inserted the mention, did not submit
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
