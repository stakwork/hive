"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { hand } from "./fonts";
import { rank, searchDesk, STATE_WORD, type SearchEntry } from "./search";

/** ⌘K: questions, options and decisions across the desk; empty, it lists the brainstorms by workspace. */
export function DeskSearch({
  entries,
  onPick,
  onClose,
}: {
  entries: SearchEntry[];
  onPick: (id: string, key: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const results = useMemo(() => searchDesk(entries, query), [entries, query]);
  const roots = useMemo(() => entries.filter((e) => e.item.id === e.key), [entries]);
  const workspaces = [...new Set(roots.map((r) => r.ws))];
  const pick = (k: number) => {
    const r = results[k];
    if (r) onPick(r.item.id, r.key);
  };
  return (
    <div
      role="dialog"
      aria-label="Search the desk"
      className={cn(
        "absolute left-3 top-14 z-40 w-[min(520px,calc(100%-24px))] overflow-hidden rounded-xl border border-[#cdbf9c] bg-[#fbf6e6] shadow-[0_12px_40px_rgba(80,60,20,.22)] animate-in fade-in-0 zoom-in-95",
        hand.className,
      )}
    >
      <input
        autoFocus
        value={query}
        aria-label="Search questions, options and decisions"
        placeholder="Search questions, options, decisions…"
        className="w-full border-b border-[#e4dac0] bg-transparent px-4 py-3 text-[20px] text-[#2f2b26] outline-none"
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") pick(index);
        }}
      />
      <ul role="listbox" className="max-h-[420px] overflow-y-auto p-1">
        {query.trim() && !results.length && (
          <li className="px-3 py-2 text-[15px] text-[#8a6a43]">Nothing on the desk matches “{query}”.</li>
        )}
        {results.map((r, k) => (
          <li key={r.item.id}>
            <button
              type="button"
              role="option"
              aria-selected={k === index}
              className={cn(
                "flex w-full items-baseline gap-3 rounded-lg px-3 py-2 text-left text-[17px] text-[#2f2b26]",
                k === index ? "bg-white" : "hover:bg-white",
              )}
              onMouseEnter={() => setIndex(k)}
              onClick={() => pick(k)}
            >
              <span
                className={cn("w-16 shrink-0 text-[13px]", rank(r.item) === 0 ? "text-[#c8452c]" : "text-[#8a6a43]")}
              >
                {STATE_WORD[r.item.state] ?? r.item.state}
              </span>
              <span className="min-w-0 flex-1">
                {r.item.letter && <b className="mr-1.5 text-[#8a6a43]">{r.item.letter}</b>}
                {r.item.name}
                {r.item.id !== r.key && (
                  <small className="block truncate text-[13px] text-[#8a6a43]">in “{r.board}”</small>
                )}
              </span>
            </button>
          </li>
        ))}
        {!query.trim() &&
          workspaces.map((ws) => (
            <li key={ws}>
              <div className="px-3 pb-0.5 pt-2 text-[13px] tracking-wide text-[#8a6a43]">{ws}</div>
              {roots
                .filter((r) => r.ws === ws)
                .map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className="block w-full truncate rounded-lg px-3 py-1.5 text-left text-[17px] text-[#2f2b26] hover:bg-white"
                    onClick={() => onPick(r.key, r.key)}
                  >
                    {r.item.name}
                  </button>
                ))}
            </li>
          ))}
      </ul>
    </div>
  );
}
