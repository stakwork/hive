"use client";

import { type CSSProperties, useEffect, useState } from "react";
import type { CanvasJob } from "../../_state/useCanvasJobs";
import {
  type Author,
  type Board,
  type Option,
  type PlanNode,
  type WorkState,
  byId,
  followUpTo,
  kids,
  plural,
} from "./board";
import type { Work } from "./build";
import type { Pencil } from "./proposals";
import { hand, serif } from "./fonts";
import { a, v } from "./theme";

/** Everything is typeset, except a person's own words. */
export const TYPE = serif.style.fontFamily;

/** Handwriting runs small for its size, so it gets a little more. */
export const authored = (who: Author, size: number): CSSProperties =>
  who === "person"
    ? { fontFamily: hand.style.fontFamily, fontSize: size * 1.14, lineHeight: 1.12 }
    : { fontFamily: TYPE, fontSize: size, lineHeight: 1.24 };

export const label: CSSProperties = {
  fontFamily: TYPE,
  fontSize: 10.5,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: v("faint"),
};
/** Controls on a card: a press there isn't a pan or a click on the card. */
export const stop = {
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
};

export interface NodeActions {
  ask: (id: string, anchor: DOMRect) => void;
  setStatus: (reqId: string, status: "accepted" | "dropped" | "proposed") => void;
  /** A requirement typed in by hand. */
  addRequirement: (storyId: string, text: string) => void;
  /** Rewrite a card's words: a container's name, a brief's, story's or requirement's text. */
  rename: (id: string, text: string) => void;
  /** Delete a story (and its requirements) or a requirement. */
  remove: (id: string) => void;
  /** A user story on the initiative. */
  addStory: (initiativeId: string, text: string) => void;
  /** A feature added by hand under a milestone. */
  addFeature: (milestoneId: string, text: string) => void;
  /** Choose an answer, or un-choose it if it's already chosen. */
  choose: (questionId: string, optionId: string) => void;
  /** Expand an answer: Jamie asks the question it raises and answers it, a deeper branch of the tree. */
  expand: (questionId: string, optionId: string) => void;
  /** Jamie suggests more answers to a question. */
  moreOptions: (questionId: string) => void;
  /** Start a feature's build: a job on it, whose pull requests come back to the card. */
  implement: (featureId: string) => void;
}

/** What every card reads besides itself: the board, the jobs on it, and what it can do. */
export interface CardContext {
  board: Board;
  jobs: Record<string, CanvasJob[]>;
  actions: NodeActions;
  /** A card to highlight for a moment (search, "pull up"). */
  flash: string | null;
  /** Where the build is, for the cards of the initiative you're in (its jobs are read); unknown elsewhere. */
  work: (id: string) => Work | undefined;
  /** Accept or reject one of strut's proposals (a pencil card, or a pencil edit on a card). Resolves to whether it went through. */
  decide: (p: Pencil, action: "accept" | "reject") => Promise<boolean>;
}

export const pill = (size: number, extra?: CSSProperties): CSSProperties => ({
  fontFamily: TYPE,
  fontSize: size,
  padding: `${size * 0.25}px ${size * 0.75}px`,
  borderRadius: 99,
  border: `1px solid ${v("borderStrong")}`,
  background: v("field"),
  color: v("ink"),
  cursor: "pointer",
  whiteSpace: "nowrap",
  lineHeight: 1.3,
  ...extra,
});

function AskChip({ id, actions, size = 12 }: { id: string; actions: NodeActions; size?: number }) {
  return (
    <button
      type="button"
      data-ask={id}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        actions.ask(id, e.currentTarget.getBoundingClientRect());
      }}
      style={pill(size, { background: v("chrome") })}
    >
      ✦ Ask Jamie
    </button>
  );
}

/** Colour is state: grey not started, blue in progress, green done, amber blocked. */
export const STATE: Record<WorkState, { label: string; color: string; bg: string; fg: string }> = {
  "not-started": { label: "Not started", color: v("notStarted"), bg: "transparent", fg: v("muted") },
  "in-progress": { label: "In progress", color: v("job"), bg: v("jobBg"), fg: v("job") },
  done: { label: "Done", color: v("done"), bg: v("done"), fg: v("onDone") },
  blocked: { label: "Blocked", color: v("blocked"), bg: v("blockedBg"), fg: v("blockedInk") },
};

/** The one status a reader needs: a filled pill, so "done" reads at a glance. */
export function StatusPill({ state, size }: { state: WorkState; size: number }) {
  const s = STATE[state];
  return (
    <span
      data-state={state}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.35,
        padding: `${size * 0.15}px ${size * 0.6}px`,
        borderRadius: 99,
        border: `1px solid ${s.color}`,
        background: s.bg,
        color: s.fg,
        fontFamily: TYPE,
        fontSize: size,
        fontWeight: 600,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {state === "done" ? "✓ " : null}
      {s.label}
    </span>
  );
}

/** A small dot for a status in a list: hollow not started, half moving, full done. */
function Dot({ state, size }: { state: WorkState; size: number }) {
  const s = STATE[state];
  return (
    <span
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: 99,
        boxSizing: "border-box",
        border: `1.5px solid ${s.color}`,
        background:
          state === "done"
            ? s.color
            : state === "in-progress"
              ? `linear-gradient(90deg, ${s.color} 50%, transparent 50%)`
              : "transparent",
      }}
    />
  );
}

/** One level down, and nothing more: each milestone (or feature) with its status. */
function ChildList({ c, node, size, max }: { c: CardContext; node: PlanNode; size: number; max: number }) {
  const b = c.board;
  const what = node.type === "initiative" ? "milestone" : "feature";
  const list = kids(b, node.id, what);
  // Not read yet: what's in it isn't known, so say nothing rather than "none".
  if (!list.length && node.unread) return null;
  if (!list.length)
    return <div style={{ fontFamily: TYPE, fontSize: size, color: v("notStarted") }}>No {what}s yet</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: size * 0.35, minHeight: 0 }}>
      <div style={{ fontFamily: TYPE, fontSize: size * 0.95, color: v("muted") }}>{plural(list.length, what)}</div>
      {list.slice(0, max).map((k) => {
        const st = c.work(k.id)?.state;
        return (
          <div
            key={k.id}
            data-child={k.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: size * 0.5,
              fontFamily: TYPE,
              fontSize: size,
              color: v("ink"),
            }}
          >
            {st ? <Dot state={st} size={size * 0.7} /> : null}
            <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {k.name}
            </span>
            {st ? (
              <span
                style={{ color: st === "done" ? v("done") : STATE[st].fg, fontSize: size * 0.88, whiteSpace: "nowrap" }}
              >
                {STATE[st].label}
              </span>
            ) : null}
          </div>
        );
      })}
      {list.length > max ? (
        <div style={{ fontFamily: TYPE, fontSize: size * 0.85, color: v("notStarted") }}>
          and {list.length - max} more
        </div>
      ) : null}
    </div>
  );
}

const kicker = (n: PlanNode) =>
  (n.pencil ? "Proposed · " : "") +
  (n.type === "milestone"
    ? `Milestone ${n.sequence ?? ""}`
    : ({ initiative: "Initiative", feature: "Feature", brief: "Brief" }[n.type as string] ?? n.type));

/** A closed container or a brief, as it looks from one level up: its name, its status, and one level down. */
/** Pencil: a card or change strut has proposed, waiting on a person. */
const PENCIL_BORDER = `1.5px dashed ${v("fork")}`;

/**
 * One of strut's proposals on a card: what it is (said from what it does),
 * why, and Accept / Reject through the same decide route as the chat's card.
 */
export function PencilBar({ c, pencil, size = 11 }: { c: CardContext; pencil: Pencil; size?: number }) {
  const [deciding, setDeciding] = useState<"accept" | "reject" | null>(null);
  const decide = async (action: "accept" | "reject") => {
    setDeciding(action);
    if (!(await c.decide(pencil, action))) setDeciding(null);
  };
  return (
    <div
      data-pencil={pencil.proposalId}
      style={{ display: "flex", flexDirection: "column", gap: size * 0.4, flexShrink: 0 }}
      {...stop}
    >
      <div style={{ fontFamily: TYPE, fontSize: size, color: v("fork"), lineHeight: 1.3 }}>
        ✎ {pencil.title}
        {pencil.rationale ? (
          <span style={{ display: "block", color: v("muted"), fontSize: size * 0.92 }}>{pencil.rationale}</span>
        ) : null}
      </div>
      <div style={{ display: "flex", gap: size * 0.45 }}>
        <button
          type="button"
          data-pencil-accept={pencil.proposalId}
          disabled={!!deciding}
          onClick={() => void decide("accept")}
          style={pill(size, {
            background: v("ink"),
            color: v("onInk"),
            borderColor: v("ink"),
            opacity: deciding ? 0.6 : 1,
          })}
        >
          {deciding === "accept" ? "Accepting…" : "Accept"}
        </button>
        <button
          type="button"
          data-pencil-reject={pencil.proposalId}
          disabled={!!deciding}
          onClick={() => void decide("reject")}
          style={pill(size, { opacity: deciding ? 0.6 : 1 })}
        >
          {deciding === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </div>
  );
}

/** A proposed edit as a pencil diff: the words now, struck through, and strut's words after them. */
function PencilDiff({ was, now }: { was: string; now: string }) {
  return (
    <span data-pencil-diff>
      <s style={{ color: v("muted"), fontWeight: 400 }}>{was}</s> <span style={{ color: v("fork") }}>{now}</span>
    </span>
  );
}

export function Face({ c, node, w, h }: { c: CardContext; node: PlanNode; w: number; h: number }) {
  const big = node.type === "initiative";
  const work = c.work(node.id);
  const running = (c.jobs[node.id] ?? []).some((j) => j.state === "running");
  return (
    <div
      className={running ? "icb-glow" : undefined}
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        padding: big ? "18px 22px" : 14,
        borderRadius: big ? 26 : 10,
        background: big ? v("cardInitiative") : v("card"),
        border: node.pencil ? PENCIL_BORDER : big ? `1px solid ${a("road", 25)}` : `1px solid ${v("border")}`,
        boxShadow: node.pencil ? "none" : big ? v("shadowBig") : v("shadow"),
        display: "flex",
        flexDirection: "column",
        gap: 7,
        color: v("ink"),
        overflow: "hidden",
        cursor: node.type === "brief" || node.pencil ? "default" : "pointer",
      }}
    >
      <div style={label}>{kicker(node)}</div>
      {node.type === "brief" ? (
        <div data-wheel-scroll style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {node.pencilEdit ? (
            <div style={authored(node.author, 14)}>
              <PencilDiff was={node.name} now={node.pencilEdit.name} />
            </div>
          ) : (
            <EditableText
              value={node.name}
              onSave={(t) => c.actions.rename(node.id, t)}
              testId={node.id}
              maxRows={12}
              style={authored(node.author, 14)}
            />
          )}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontFamily: TYPE,
                fontSize: big ? 27 : node.type === "milestone" ? 20 : 19,
                fontWeight: 600,
                lineHeight: 1.15,
              }}
            >
              {node.pencilEdit ? (
                <PencilDiff was={node.name || "Untitled"} now={node.pencilEdit.name} />
              ) : (
                node.name || "Untitled"
              )}
            </div>
            {node.type === "feature" && work ? <StatusPill state={work.state} size={11} /> : null}
          </div>
          {node.type === "feature" ? (
            <div style={{ fontFamily: TYPE, fontSize: 11.5, color: v("muted") }}>{work?.line}</div>
          ) : (
            <div style={{ minHeight: 0, overflow: "hidden" }}>
              <ChildList c={c} node={node} size={big ? 13 : 11.5} max={3} />
            </div>
          )}
          <div style={{ flex: 1 }} />
        </>
      )}
      {node.pencil || node.pencilEdit ? (
        <PencilBar c={c} pencil={(node.pencil ?? node.pencilEdit)!} size={big ? 13 : 10.5} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", flexShrink: 0 }}>
          <AskChip id={node.id} actions={c.actions} size={big ? 13 : 10.5} />
        </div>
      )}
    </div>
  );
}

/** The header band of an open container: its name (click to rename), its status, and Ask Jamie. */
export function FrameHeader({ c, node, w, h }: { c: CardContext; node: PlanNode; w: number; h: number }) {
  const b = c.board;
  // Not read yet: no counts or status, rather than "0 milestones".
  const work = node.unread ? undefined : c.work(node.id);
  const what = node.unread
    ? ""
    : node.type === "initiative"
      ? `${plural(kids(b, node.id, "story").length, "user story", "user stories")} · ${plural(kids(b, node.id, "milestone").length, "milestone")}`
      : node.type === "milestone"
        ? plural(kids(b, node.id, "feature").length, "feature")
        : (work?.line ?? "");
  return (
    <div
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        padding: "12px 22px",
        display: "flex",
        alignItems: "center",
        gap: 18,
        color: v("ink"),
        cursor: "pointer",
      }}
    >
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={label}>{kicker(node)}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          {node.pencilEdit ? (
            <span style={{ fontFamily: TYPE, fontSize: 26, fontWeight: 600, whiteSpace: "nowrap" }}>
              <PencilDiff was={node.name || "Untitled"} now={node.pencilEdit.name} />
            </span>
          ) : (
            <EditableText
              value={node.name || "Untitled"}
              onSave={(t) => c.actions.rename(node.id, t)}
              testId={node.id}
              style={{ fontFamily: TYPE, fontSize: 26, fontWeight: 600, whiteSpace: "nowrap" }}
            />
          )}
          {work ? <StatusPill state={work.state} size={13} /> : null}
          <span style={{ fontFamily: TYPE, fontSize: 13, color: v("muted"), whiteSpace: "nowrap" }}>{what}</span>
        </div>
      </div>
      {node.pencil || node.pencilEdit ? (
        <div style={{ maxWidth: 360 }}>
          <PencilBar c={c} pencil={(node.pencil ?? node.pencilEdit)!} size={13} />
        </div>
      ) : (
        <AskChip id={node.id} actions={c.actions} size={13} />
      )}
    </div>
  );
}

/**
 * Words you click to edit in place: dark on white while editing, Enter saves,
 * Esc cancels. With `onDelete`, editing also offers Delete.
 */
function EditableText({
  value,
  onSave,
  onDelete,
  style,
  testId,
  maxRows = 4,
  wrap = false,
}: {
  value: string;
  onSave: (text: string) => void;
  onDelete?: () => void;
  style: CSSProperties;
  testId: string;
  /** The most rows the field grows to before it scrolls. */
  maxRows?: number;
  /** Wrap full-width text instead of ellipsizing; the field auto-grows. */
  wrap?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing)
    return (
      <span
        data-edit={testId}
        title="Click to edit"
        {...stop}
        onClick={(e) => {
          e.stopPropagation();
          setText(value);
          setEditing(true);
        }}
        className="icb-editable"
        style={{
          ...style,
          display: "block",
          cursor: "text",
          borderRadius: 4,
          ...(wrap
            ? { whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
            : { overflow: "hidden", textOverflow: "ellipsis" }),
        }}
      >
        {value}
      </span>
    );
  const save = () => {
    if (text.trim() && text.trim() !== value) onSave(text.trim());
    setEditing(false);
  };
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "flex-start", width: "100%" }} {...stop}>
      <textarea
        autoFocus
        rows={wrap ? 1 : Math.min(maxRows, Math.max(1, Math.ceil(text.length / 28)))}
        ref={
          wrap
            ? (el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }
              }
            : undefined
        }
        data-edit-input={testId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (wrap) {
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }
        }}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") setEditing(false);
        }}
        style={{
          flex: 1,
          minWidth: 0,
          border: `1px solid ${v("borderStrong")}`,
          borderRadius: 6,
          background: v("field"),
          color: v("fieldInk"),
          padding: "3px 7px",
          fontFamily: TYPE,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          outline: "none",
          resize: "none",
          overflowY: wrap ? "hidden" : "auto",
          lineHeight: 1.3,
        }}
      />
      {onDelete ? (
        <button
          type="button"
          data-delete={testId}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setEditing(false);
            onDelete();
          }}
          style={pill(10, { color: v("blockedInk"), borderColor: v("blockedBorder") })}
        >
          Delete
        </button>
      ) : null}
    </span>
  );
}

/** "+ Add …" that turns into a field: dark text on white, Enter saves, Esc cancels. */
function AddInline({
  what,
  onAdd,
  size = 12,
  testId,
}: {
  what: string;
  onAdd: (text: string) => void;
  size?: number;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open)
    return (
      <button
        type="button"
        data-add={testId}
        {...stop}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        style={pill(size, { border: `1px dashed ${v("borderStrong")}`, background: "transparent", color: v("road") })}
      >
        + Add {what}
      </button>
    );
  const save = () => {
    if (text.trim()) onAdd(text.trim());
    setText("");
    setOpen(false);
  };
  return (
    <input
      autoFocus
      data-add-input={testId}
      value={text}
      placeholder={`New ${what}…`}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") save();
        if (e.key === "Escape") setOpen(false);
      }}
      {...stop}
      style={{
        width: "100%",
        boxSizing: "border-box",
        border: `1px solid ${v("borderStrong")}`,
        borderRadius: 6,
        background: v("field"),
        color: v("fieldInk"),
        padding: "5px 8px",
        fontFamily: TYPE,
        fontSize: size + 1,
        outline: "none",
      }}
    />
  );
}

const actBtn: CSSProperties = {
  background: "none",
  border: "none",
  padding: "0 2px",
  cursor: "pointer",
  fontFamily: TYPE,
  fontSize: 10.5,
  color: "var(--ic-road)",
  textDecoration: "underline",
};

/** A requirement: dashed when proposed, ticked when accepted, struck and faded when dropped. Actions appear on hover/focus. */
function ReqRow({ c, r, onDelete }: { c: CardContext; r: PlanNode; onDelete: (r: PlanNode) => void }) {
  const dropped = r.status === "dropped";
  const accepted = r.status === "accepted";
  const proposed = !dropped && !accepted;
  const toggleAccept = () => c.actions.setStatus(r.id, accepted ? "proposed" : "accepted");
  return (
    <div
      data-req={r.id}
      data-status={proposed ? "proposed" : r.status}
      className={`icb-req${c.flash === r.id ? " icb-flash" : ""}`}
      style={{ display: "flex", gap: 7, padding: "3px 6px 3px 0", borderRadius: 5 }}
    >
      <span
        role="checkbox"
        aria-checked={accepted}
        title={accepted ? "Unaccept" : "Accept"}
        {...stop}
        onClick={(e) => {
          e.stopPropagation();
          if (!dropped) toggleAccept();
        }}
        style={{
          flexShrink: 0,
          width: 14,
          height: 14,
          marginTop: 2,
          borderRadius: 4,
          cursor: dropped ? "default" : "pointer",
          border: proposed ? `1.3px dashed ${v("notStarted")}` : `1.3px solid ${dropped ? v("dropped") : v("done")}`,
          color: dropped ? v("dropped") : v("done"),
          fontSize: 10.5,
          lineHeight: "12px",
          textAlign: "center",
          fontFamily: TYPE,
          background: v("field"),
        }}
      >
        {accepted ? "✓" : dropped ? "–" : ""}
      </span>
      <div style={{ minWidth: 0, flex: 1, opacity: dropped ? 0.55 : 1 }}>
        {r.pencilEdit ? (
          <div style={authored(r.author, 12.5)}>
            <PencilDiff was={r.name} now={r.pencilEdit.name} />
          </div>
        ) : (
          <EditableText
            wrap
            value={r.name}
            onSave={(t) => c.actions.rename(r.id, t)}
            testId={r.id}
            style={{
              ...authored(r.author, 12.5),
              color: proposed ? v("proposedInk") : v("ink"),
              textDecoration: dropped ? "line-through" : undefined,
            }}
          />
        )}
        {r.pencil || r.pencilEdit ? (
          <div style={{ marginTop: 3 }}>
            <PencilBar c={c} pencil={(r.pencil ?? r.pencilEdit)!} size={9.5} />
          </div>
        ) : null}
      </div>
      {r.pencil || r.pencilEdit ? null : (
        <div className="icb-act" style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "flex-start" }} {...stop}>
          {dropped ? (
            <button type="button" data-restore={r.id} style={actBtn} onClick={() => c.actions.setStatus(r.id, "proposed")}>
              Restore
            </button>
          ) : (
            <>
              <button type="button" data-accept={r.id} style={actBtn} onClick={toggleAccept}>
                {accepted ? "Unaccept" : "Accept"}
              </button>
              <button type="button" data-drop={r.id} style={actBtn} onClick={() => c.actions.setStatus(r.id, "dropped")}>
                Drop
              </button>
            </>
          )}
          <button type="button" data-delete={r.id} style={actBtn} onClick={() => onDelete(r)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * An initiative's user stories, the journeys, as a full-height bullet list
 * with their requirements indented beneath. They live and are edited here only.
 */
export function StoriesPanel({ c, initiative, w, h }: { c: CardContext; initiative: string; w: number; h: number }) {
  const b = c.board;
  const stories = kids(b, initiative, "story");
  const reqs = stories.flatMap((st) => kids(b, st.id, "requirement"));
  const unread = byId(b, initiative)?.unread;
  // The last deleted requirement, offered back for ~8s under its story.
  const [undo, setUndo] = useState<{ storyId: string; text: string } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);
  const delReq = (storyId: string) => (r: PlanNode) => {
    c.actions.remove(r.id);
    setUndo({ storyId, text: r.name });
  };
  // A journey is pending (muted) until every requirement under it is accepted or dropped.
  const pending = (id: string) => kids(b, id, "requirement").some((r) => r.status !== "accepted" && r.status !== "dropped");
  return (
    <div
      data-stories={initiative}
      style={{
        width: w,
        minHeight: h,
        boxSizing: "border-box",
        padding: "12px 16px",
        borderRadius: 10,
        background: a("card", 85),
        border: `1px solid ${v("border")}`,
        boxShadow: v("shadow"),
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={label}>User stories</span>
        <span hidden={unread} style={{ fontFamily: TYPE, fontSize: 11.5, color: v("muted") }}>
          {plural(stories.length, "journey")} · {plural(reqs.length, "requirement")}
        </span>
      </div>
      <ul style={{ listStyle: "disc", margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {stories.map((st, i) => (
          <li
            key={st.id}
            data-story={st.id}
            className={c.flash === st.id ? "icb-flash" : undefined}
            style={{
              borderLeft: st.pencil ? PENCIL_BORDER : undefined,
              paddingLeft: st.pencil ? 9 : 0,
              color: v("road"),
            }}
          >
            <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
              <span style={{ flexShrink: 0, fontFamily: TYPE, fontSize: 11.5, fontWeight: 600, color: v("road") }}>
                [{i + 1}]
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {st.pencil ? (
                  // Proposed: its words and Accept / Reject; nothing to edit until it's real.
                  <>
                    <div style={{ ...authored(st.author, 12.5), fontWeight: 400, color: v("proposedInk") }}>{st.name}</div>
                    <PencilBar c={c} pencil={st.pencil} size={10} />
                  </>
                ) : st.pencilEdit ? (
                  <>
                    <div style={authored(st.author, 12.5)}>
                      <PencilDiff was={st.name} now={st.pencilEdit.name} />
                    </div>
                    <PencilBar c={c} pencil={st.pencilEdit} size={10} />
                  </>
                ) : (
                  <EditableText
                    wrap
                    value={st.name}
                    onSave={(t) => c.actions.rename(st.id, t)}
                    onDelete={() => c.actions.remove(st.id)}
                    testId={st.id}
                    style={{
                      ...authored(st.author, 12.5),
                      ...(pending(st.id) ? { fontWeight: 400, color: v("muted") } : { fontWeight: 600 }),
                    }}
                  />
                )}
              </div>
            </div>
            <div style={{ marginLeft: 12, marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
              {kids(b, st.id, "requirement").map((r) => (
                <ReqRow key={r.id} c={c} r={r} onDelete={delReq(st.id)} />
              ))}
              {undo?.storyId === st.id ? (
                <div
                  data-undo={st.id}
                  {...stop}
                  style={{ fontFamily: TYPE, fontSize: 11, color: v("muted"), display: "flex", gap: 6 }}
                >
                  <span>Requirement deleted.</span>
                  <button
                    type="button"
                    data-undo-btn={st.id}
                    style={actBtn}
                    onClick={() => {
                      c.actions.addRequirement(st.id, undo.text);
                      setUndo(null);
                    }}
                  >
                    Undo
                  </button>
                </div>
              ) : null}
              <div hidden={!!st.pencil} style={{ marginTop: 2 }}>
                <AddInline
                  what="requirement"
                  size={10}
                  testId={st.id}
                  onAdd={(t) => c.actions.addRequirement(st.id, t)}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 4 }}>
        <AddInline
          what="user story"
          size={11}
          testId={`story:${initiative}`}
          onAdd={(t) => c.actions.addStory(initiative, t)}
        />
      </div>
    </div>
  );
}

/** The slot after a milestone's features. */
export function AddCard({
  c,
  milestoneId,
  w,
  h,
}: {
  c: CardContext;
  milestoneId: string;
  w: number;
  h: number;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        padding: 12,
        borderRadius: 8,
        border: `1.5px dashed ${a("road", 40)}`,
        background: a("card", 35),
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <AddInline
        what="feature"
        size={12}
        testId={`feature:${milestoneId}`}
        onAdd={(t) => c.actions.addFeature(milestoneId, t)}
      />
    </div>
  );
}

function Pips({ o }: { o: Option }) {
  const rated = (["fast", "good", "cheap"] as const).filter((k) => o[k] !== undefined);
  if (!rated.length) return null;
  return (
    <div
      data-fgc
      style={{ display: "flex", gap: 10, fontFamily: TYPE, fontSize: 10.5, color: v("muted"), flexWrap: "wrap" }}
    >
      {rated.map((k) => (
        <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title={`${k}: ${o[k]} of 3`}>
          {k}
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 9,
                background: i <= o[k]! ? v("fork") : "transparent",
                border: `1px solid ${v("fork")}`,
              }}
            />
          ))}
        </span>
      ))}
    </div>
  );
}

/** A brainstorm question: the root of a tree off a card, or the question an expanded answer raised. */
export function QuestionCard({
  c,
  node,
  w,
  h,
  busy,
  folded,
}: {
  c: CardContext;
  node: PlanNode;
  w: number;
  h: number;
  /** Jamie is answering something: asks that start a turn wait. */
  busy: boolean;
  /** One of several brainstorms on the card, not the open one: a summary, click to open. */
  folded: boolean;
}) {
  const follow = !!node.follows;
  const chosen = node.options?.find((o) => o.chosen);
  return (
    <div
      data-question={node.id}
      className={c.flash === node.id ? "icb-flash" : undefined}
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        padding: "12px 14px",
        borderRadius: 8,
        background: v("question"),
        border: `1.5px solid ${v("fork")}`,
        boxShadow: v("shadow"),
        color: v("ink"),
        display: "flex",
        flexDirection: "column",
        gap: 6,
        overflow: "hidden",
      }}
    >
      <div style={{ ...label, color: v("fork") }}>
        {follow ? "Expanded" : "Brainstorm"} · {node.decided ? "decided" : "open"}
      </div>
      <div style={{ ...authored(node.author, follow ? 15 : 17), overflow: "hidden" }}>{node.name}</div>
      <div style={{ flex: 1 }} />
      {folded ? (
        <div data-folded style={{ fontFamily: TYPE, fontSize: 11, color: v("muted") }}>
          {plural(node.options?.length ?? 0, "option")} ·{" "}
          {chosen ? <span style={{ color: v("fork") }}>chose {chosen.title}</span> : "undecided"}
          <div style={{ color: v("fork"), marginTop: 2 }}>Click to open</div>
        </div>
      ) : follow ? null : (
        <div style={{ fontFamily: TYPE, fontSize: 10.5, color: v("muted") }}>
          about {byId(c.board, node.about ?? "")?.name}
        </div>
      )}
      <div {...stop} style={{ display: folded ? "none" : undefined }}>
        <button
          type="button"
          data-more={node.id}
          disabled={busy}
          onClick={() => c.actions.moreOptions(node.id)}
          style={pill(11, {
            borderColor: v("fork"),
            color: v("fork"),
            background: a("field", 70),
            opacity: busy ? 0.5 : 1,
          })}
        >
          + More options
        </button>
      </div>
    </div>
  );
}

/** What choosing an answer makes, by what its brainstorm is about. */
const MAKES_WHAT: Record<string, string> = { initiative: "milestones", milestone: "features" };

/**
 * One answer to a question: weighed against the plan's requirements and on
 * fast / good / cheap, with what choosing it makes. Choose it (click again
 * to undo), or expand it to see the question it raises.
 */
export function OptionCard({
  c,
  q,
  o,
  w,
  h,
  busy,
}: {
  c: CardContext;
  q: PlanNode;
  o: Option;
  w: number;
  h: number;
  busy: boolean;
}) {
  const other = (!!q.decided && !o.chosen) || o.rejected;
  const reqName = (id: string | null) => (id ? byId(c.board, id)?.name : undefined);
  const hasFollowUp = !!followUpTo(c.board, o.id);
  // A feature's answers make nothing: its build is the jobs started on it.
  const what = MAKES_WHAT[byId(c.board, q.about ?? "")?.type ?? ""];
  const makes = o.makes ?? [o.title];
  return (
    <div
      data-option={o.id}
      data-chosen={o.chosen || undefined}
      style={{
        width: w,
        height: h,
        boxSizing: "border-box",
        padding: "10px 12px",
        borderRadius: 8,
        color: v("ink"),
        display: "flex",
        flexDirection: "column",
        gap: 5,
        overflow: "hidden",
        transition: "border-color .3s, background .3s, box-shadow .3s, opacity .3s",
        ...(o.chosen
          ? {
              background: v("card"),
              border: `2.5px solid ${v("fork")}`,
              boxShadow: `${v("shadow")}, 0 0 0 5px ${a("fork", 15)}`,
            }
          : { background: v("option"), border: `1.5px dashed ${v("fork")}`, opacity: other ? 0.6 : 1 }),
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <b style={{ fontFamily: TYPE, fontSize: 12, color: v("fork") }}>{o.letter}</b>
        <span style={{ ...authored(o.author, 14.5), flex: 1, textDecoration: o.rejected ? "line-through" : undefined }}>
          {o.title}
        </span>
      </div>
      <div
        data-wheel-scroll
        style={{ display: "flex", flexDirection: "column", gap: 3, minHeight: 0, overflowY: "auto" }}
      >
        {o.pros.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 5, fontFamily: TYPE, fontSize: 11, lineHeight: 1.3 }}>
            <span style={{ color: p.good ? v("done") : v("con"), fontWeight: 700 }}>{p.good ? "+" : "−"}</span>
            <span>
              {p.text}
              {reqName(p.req) ? <span style={{ color: v("faint") }}> · “{reqName(p.req)}”</span> : null}
            </span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      {!what ? null : (
        <div
          data-makes={o.id}
          style={{ fontFamily: TYPE, fontSize: 10.5, color: makes.length ? v("fork") : v("notStarted") }}
        >
          {makes.length ? `Makes: ${makes.join(", ")}` : `Makes no ${what}`}
        </div>
      )}
      <Pips o={o} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }} {...stop}>
        <button
          type="button"
          data-choose={o.id}
          title={o.chosen ? "Click to undo" : undefined}
          onClick={() => c.actions.choose(q.id, o.id)}
          style={pill(
            11,
            o.chosen
              ? { borderColor: v("fork"), background: v("fork"), color: v("onFork") }
              : { borderColor: v("fork"), color: v("fork") },
          )}
        >
          {o.chosen ? "✓ Chosen" : "Choose"}
        </button>
        {hasFollowUp ? null : (
          <button
            type="button"
            data-expand-option={o.id}
            disabled={busy}
            title="Dig into this answer: what it raises, and the answers to that"
            onClick={() => c.actions.expand(q.id, o.id)}
            style={pill(11, { opacity: busy ? 0.5 : 1 })}
          >
            Expand
          </button>
        )}
        <span style={{ marginLeft: "auto", fontFamily: TYPE, fontSize: 9.5, color: v("notStarted") }}>
          {o.author === "strut" ? "suggested by Jamie" : ""}
        </span>
      </div>
    </div>
  );
}

/** A job on a card: while it runs, what it's doing and who started it; when it settles, a tick (or "didn't finish"). */
export function JobMarker({ job }: { job: CanvasJob }) {
  const running = job.state === "running";
  const failed = job.state === "failed";
  const who = job.startedBy?.name;
  return (
    <div
      data-job={job.jobId}
      data-job-state={job.state}
      className="icb-bloom"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        maxWidth: "min(420px, 100%)",
        minWidth: 0,
        boxSizing: "border-box",
        padding: "4px 11px",
        borderRadius: 99,
        background: running ? v("jobBg") : v("chrome"),
        border: `1px solid ${running ? v("jobBorder") : v("borderStrong")}`,
        boxShadow: v("shadow"),
        fontFamily: TYPE,
        fontSize: 12.5,
        color: running ? v("job") : v("muted"),
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {running ? (
        <span className="icb-spin" />
      ) : (
        <span style={{ color: failed ? v("blocked") : v("done") }}>{failed ? "!" : "✓"}</span>
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {running
          ? "Jamie is working on this…"
          : failed
            ? `Didn't finish: ${job.title}`
            : "Done"}
      </span>
      {who && running ? <span style={{ color: v("notStarted"), flexShrink: 0 }}>· {who}</span> : null}
    </div>
  );
}
