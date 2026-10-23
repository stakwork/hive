"use client";

import { type CSSProperties, memo, useState } from "react";
import { formatAge } from "@/lib/date-utils";
import { type Board, initiativesByRecency, plural } from "./board";
import { TYPE, label } from "./nodes";
import type { Rect, Viewport } from "./scene";
import { a, v } from "./theme";

/** The pile of initiatives not on the desk: the top few names, and how many more. */
export const StackCard = memo(function StackCard({
  b,
  desk,
  w,
  h,
}: {
  b: Board;
  desk: string[];
  w: number;
  h: number;
}) {
  const rest = initiativesByRecency(b).filter((n) => !desk.includes(n.id));
  const sheet = (i: number): CSSProperties => ({
    position: "absolute",
    inset: 0,
    transform: `translate(${i * 7}px, ${i * -7}px) rotate(${i * 1.2}deg)`,
    borderRadius: 18,
    background: v("cardInitiative"),
    border: `1px solid ${a("road", 25)}`,
    boxShadow: v("shadow"),
  });
  return (
    <div style={{ position: "relative", width: w, height: h }}>
      <div style={sheet(2)} />
      <div style={sheet(1)} />
      <div
        style={{
          ...sheet(0),
          padding: 14,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 5,
          fontFamily: TYPE,
          color: v("ink"),
        }}
      >
        <div style={label}>Older initiatives</div>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{rest.length} more</div>
        {rest.slice(0, 3).map((n) => (
          <div
            key={n.id}
            style={{
              flexShrink: 0,
              fontSize: 13,
              color: v("muted"),
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {n.name}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: v("road") }}>See all →</div>
      </div>
    </div>
  );
});

/** Every initiative, most recently updated first, next to the stack: filter by name, pick one to bring it onto the desk. */
export function AllInitiatives({
  board,
  desk,
  anchor,
  vp,
  close,
  pick,
}: {
  board: Board;
  desk: string[];
  /** The stack on screen: the list opens beside it. */
  anchor: Rect;
  vp: Viewport;
  close: () => void;
  pick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const all = initiativesByRecency(board);
  const list = all.filter((n) => n.name.toLowerCase().includes(q.trim().toLowerCase()));
  const w = 400;
  // Beside the stack: to its left when there's no room on the right.
  const left = anchor.x + anchor.w + 16 + w < vp.w - 16 ? anchor.x + anchor.w + 16 : Math.max(16, anchor.x - w - 16);
  return (
    <div
      data-all-initiatives
      data-canvas-chrome
      className="icb-bloom"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left,
        top: Math.max(70, Math.min(anchor.y, vp.h - 460)),
        width: w,
        maxHeight: 440,
        display: "flex",
        flexDirection: "column",
        borderRadius: 14,
        background: v("sheet"),
        border: `1px solid ${v("chromeBorder")}`,
        boxShadow: v("shadowPop"),
        overflow: "hidden",
        zIndex: 30,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: `1px solid ${v("border")}`,
        }}
      >
        <input
          autoFocus
          data-all-filter
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") close();
            if (e.key === "Enter" && list[0]) pick(list[0].id);
          }}
          placeholder={`All ${plural(all.length, "initiative")}…`}
          aria-label="Filter initiatives"
          style={{
            flex: 1,
            border: `1px solid ${v("border")}`,
            borderRadius: 8,
            background: v("field"),
            color: v("fieldInk"),
            padding: "6px 10px",
            fontFamily: TYPE,
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          style={{ border: "none", background: "none", cursor: "pointer", color: v("muted"), fontSize: 18 }}
        >
          ×
        </button>
      </div>
      <div style={{ overflowY: "auto", padding: 6 }}>
        {list.map((n) => (
          <button
            key={n.id}
            type="button"
            data-pick={n.id}
            onClick={() => pick(n.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              textAlign: "left",
              border: "none",
              borderRadius: 8,
              background: "transparent",
              padding: "8px 10px",
              cursor: "pointer",
              fontFamily: TYPE,
              color: v("ink"),
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 14.5,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {n.name}
              </span>
              <span style={{ fontSize: 12, color: v("muted") }}>
                {n.updatedAt ? `updated ${formatAge(Date.now() - n.updatedAt)}` : ""}
                {desk.includes(n.id) ? " · on the desk" : ""}
              </span>
            </span>
          </button>
        ))}
        {!list.length ? (
          <div style={{ padding: 12, fontFamily: TYPE, fontSize: 13, color: v("muted") }}>
            No initiative called that.
          </div>
        ) : null}
      </div>
    </div>
  );
}
