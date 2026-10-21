"use client";

import { useEffect, useRef, useState } from "react";
import { type Board, SEARCHABLE, pathOf } from "./board";
import { TYPE } from "./nodes";
import { v } from "./theme";

/** ⌘K: find any initiative, milestone, feature, story or requirement, grouped by type; Enter dives there. */
export function Palette({
  board,
  left,
  close,
  pick,
}: {
  board: Board;
  left: number;
  close: () => void;
  pick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const query = q.trim().toLowerCase();
  const groups = SEARCHABLE.map((g) => ({
    ...g,
    hits: board.nodes
      .filter(
        (n) =>
          n.type === g.type &&
          (query ? n.name.toLowerCase().includes(query) : g.type !== "story" && g.type !== "requirement"),
      )
      .slice(0, query ? 6 : 8),
  })).filter((g) => g.hits.length);
  const flat = groups.flatMap((g) => g.hits);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let i = -1;
  return (
    <div
      data-palette
      className="icb-bloom"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left,
        top: 58,
        width: "min(560px, calc(100% - 32px))",
        borderRadius: 14,
        background: v("sheet"),
        border: `1px solid ${v("chromeBorder")}`,
        boxShadow: v("shadowPop"),
        overflow: "hidden",
        zIndex: 40,
      }}
    >
      <input
        autoFocus
        data-palette-input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(flat.length - 1, a + 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          if (e.key === "Enter" && flat[active]) pick(flat[active].id);
          if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"))
            (e.preventDefault(), close());
        }}
        onBlur={() => setTimeout(close, 120)}
        placeholder="Find an initiative, milestone, feature, story or requirement…"
        style={{
          width: "100%",
          boxSizing: "border-box",
          border: "none",
          borderBottom: `1px solid ${v("border")}`,
          background: v("field"),
          color: v("fieldInk"),
          padding: "14px 16px",
          fontFamily: TYPE,
          fontSize: 16,
          outline: "none",
        }}
      />
      <div ref={list} style={{ maxHeight: 420, overflowY: "auto", padding: 6 }}>
        {groups.map((g) => (
          <div key={g.type}>
            <div
              style={{
                fontFamily: TYPE,
                fontSize: 10.5,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: v("faint"),
                padding: "8px 10px 4px",
              }}
            >
              {g.label}
            </div>
            {g.hits.map((n) => {
              i += 1;
              const idx = i;
              const on = idx === active;
              return (
                <button
                  key={n.id}
                  type="button"
                  data-index={idx}
                  data-hit={n.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => pick(n.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    borderRadius: 8,
                    background: on ? v("field") : "transparent",
                    boxShadow: on ? `0 0 0 1px ${v("chromeBorder")}` : "none",
                    padding: "7px 10px",
                    cursor: "pointer",
                    color: v("ink"),
                    fontFamily: TYPE,
                  }}
                >
                  <div style={{ fontSize: 14 }}>{n.name}</div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: v("muted"),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {["Org", ...pathOf(board, n)].join(" › ")}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
        {!flat.length ? (
          <div style={{ fontFamily: TYPE, fontSize: 13, color: v("muted"), padding: "12px 10px" }}>
            Nothing called that yet.
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          gap: 14,
          padding: "8px 14px",
          borderTop: `1px solid ${v("border")}`,
          fontFamily: TYPE,
          fontSize: 11.5,
          color: v("muted"),
        }}
      >
        <span>↑↓ move</span>
        <span>↵ go there</span>
        <span>esc close</span>
        <span style={{ marginLeft: "auto", color: v("job") }}>or tell Jamie “pull up …”</span>
      </div>
    </div>
  );
}
