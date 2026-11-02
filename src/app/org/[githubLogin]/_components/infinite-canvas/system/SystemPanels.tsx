"use client";

/**
 * The System view's panels: the detail of a stack (level 3) and of a tier
 * (level 4: its jobs, pull requests and decisions), with "Place in district"
 * and "Extends…"; and the List view (the same model, grouped by district).
 * Colours are `theme.ts` tokens.
 */

import type { CSSProperties } from "react";
import type { CanvasJob } from "@/lib/canvas/canvas-jobs";
import type { ArtifactRef, ArtifactVersion } from "../../../_state/canvasChatArtifacts";
import { ChatArtifacts } from "../../artifacts/ChatArtifacts";
import { TYPE, label, pill } from "../nodes";
import { a, v } from "../theme";
import { type District, type SystemModel, type Tier, type TierState, UNASSIGNED } from "./model";

const NO_VERSIONS = new Map<ArtifactRef, ArtifactVersion>();

export const STATE_LABEL: Record<TierState, string> = { built: "Built", building: "In progress", planned: "Planned" };

/** A tier's look, as one style: solid built, dashed accent in progress, faint dotted ghost planned. */
export const tierLook = (state: TierState): CSSProperties =>
  state === "built"
    ? { background: v("sysBuilt"), color: v("sysOnBuilt"), border: `1.5px solid ${v("sysBuilt")}` }
    : state === "building"
      ? { background: v("sysBuildingBg"), color: v("ink"), border: `2px dashed ${v("sysBuilding")}` }
      : { background: "transparent", color: v("muted"), border: `1.5px dotted ${v("sysPlanned")}`, opacity: 0.8 };

export const rollupLine = (r: District["rollup"]) =>
  `${r.built} built · ${r.building} in progress · ${r.planned} planned`;

const JOB: Record<CanvasJob["state"], { label: string; color: string }> = {
  running: { label: "Running", color: v("job") },
  done: { label: "Done", color: v("done") },
  failed: { label: "Failed", color: v("blocked") },
};

/** Job rows: title, who, state. Shared by a tier's detail and the Unmapped box. */
export function JobRows({ jobs }: { jobs: readonly CanvasJob[] }) {
  return (
    <>
      {jobs.map((j) => (
        <div
          key={j.jobId}
          data-sys-job={j.jobId}
          style={{ padding: "5px 0", borderTop: `1px solid ${a("road", 12)}`, fontFamily: TYPE, fontSize: 13 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className={j.state === "running" ? "icb-pulse" : undefined}
              style={{
                width: 8,
                height: 8,
                borderRadius: 9,
                flexShrink: 0,
                border: `1.5px solid ${JOB[j.state].color}`,
                background: j.state === "done" ? v("done") : "transparent",
              }}
            />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {j.title}
              {j.startedBy?.name ? <span style={{ color: v("muted") }}> · {j.startedBy.name}</span> : null}
            </span>
            <span style={{ fontSize: 12, color: JOB[j.state].color, whiteSpace: "nowrap" }}>{JOB[j.state].label}</span>
          </div>
          {j.state === "failed" && j.error ? (
            <div style={{ paddingLeft: 16, fontSize: 12, color: v("blockedInk") }}>{j.error}</div>
          ) : null}
        </div>
      ))}
    </>
  );
}

const select: CSSProperties = {
  fontFamily: TYPE,
  fontSize: 13,
  padding: "4px 8px",
  borderRadius: 8,
  border: `1px solid ${v("borderStrong")}`,
  background: v("field"),
  color: v("fieldInk"),
  maxWidth: "100%",
};

export interface Edits {
  placeIn: (tier: Tier, district: string) => void;
  extend: (tier: Tier, parent: string) => void;
  saving: boolean;
}

/** "Place in district" and "Extends…" for one tier. */
function Affordances({ tier, model, edits }: { tier: Tier; model: SystemModel; edits: Edits }) {
  const districts = [...model.districts.values()].filter((d) => !d.unassigned);
  const sameDistrict = [...model.tiers.values()].filter((t) => t.id !== tier.id && t.district === tier.district);
  return (
    <div data-sys-affordances style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontFamily: TYPE, fontSize: 12, color: v("muted") }}>
        Place in district
        <select
          aria-label="Place in district"
          style={select}
          disabled={edits.saving || !districts.length}
          value={tier.placedBy === "unassigned" ? UNASSIGNED : tier.district}
          onChange={(e) => edits.placeIn(tier, e.target.value)}
        >
          <option value={UNASSIGNED}>
            {tier.placedBy === "unassigned" ? "Unassigned" : "Unassigned (clear the placement)"}
          </option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {tier.placedBy === "derived" && tier.district === d.id ? " (from its repos)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontFamily: TYPE, fontSize: 12, color: v("muted") }}>
        Extends…
        <select
          aria-label="Extends"
          style={select}
          disabled={edits.saving}
          value={tier.extendsId ?? ""}
          onChange={(e) => edits.extend(tier, e.target.value)}
        >
          <option value="">Nothing (a stack of its own)</option>
          {sameDistrict.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const chip: CSSProperties = {
  fontFamily: TYPE,
  fontSize: 12,
  padding: "2px 9px",
  borderRadius: 6,
  border: `1px solid ${v("border")}`,
  background: v("field"),
  color: v("inkSoft"),
};

/** One tier: status, milestone, people, and the requirements as bricks. */
function TierBlock({ tier }: { tier: Tier }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: TYPE, fontSize: 12.5 }}>
        <span style={{ ...tierLook(tier.state), padding: "1px 9px", borderRadius: 99, fontSize: 12, whiteSpace: "nowrap" }}>
          {STATE_LABEL[tier.state]}
        </span>
        {tier.blocked ? <span style={{ color: v("blocked") }}>needs attention</span> : null}
        <span style={{ color: v("muted") }}>{tier.line}</span>
      </div>
      <div style={{ fontFamily: TYPE, fontSize: 12.5, color: v("muted") }}>
        {tier.initiative.name}
        {tier.milestone ? ` › due with “${tier.milestone.name}”` : ""}
      </div>
      {tier.requirements.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }} data-sys-bricks>
          {tier.requirements.map((r) => (
            <span key={r} style={chip}>
              {r}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Level 3 (a stack) and level 4 (one tier) as a panel beside the map. */
export function DetailPanel({
  tier,
  deep,
  model,
  edits,
  onDeeper,
  onPick,
}: {
  tier: Tier;
  deep: boolean;
  model: SystemModel;
  edits: Edits;
  onDeeper: () => void;
  onPick: (id: string) => void;
}) {
  const district = model.districts.get(tier.district);
  const stack = district?.stacks.find((s) => s.some((t) => t.id === tier.id)) ?? [tier];
  return (
    <div
      data-sys-panel
      data-sys-level={deep ? 4 : 3}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        right: 16,
        top: 70,
        bottom: 150,
        width: 380,
        zIndex: 30,
        overflowY: "auto",
        boxSizing: "border-box",
        padding: "14px 16px",
        borderRadius: 12,
        background: v("sheet"),
        border: `1px solid ${v("chromeBorder")}`,
        boxShadow: v("shadowPop"),
        color: v("ink"),
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={label}>
        {district?.name ?? "Unassigned"} · {deep ? "tier" : stack.length === 1 ? "stack of one tier" : `stack of ${stack.length} tiers`}
      </div>
      {deep ? (
        <>
          <div style={{ fontFamily: TYPE, fontSize: 18, fontWeight: 600 }}>{tier.name}</div>
          <TierBlock tier={tier} />
          <div style={label}>Jobs</div>
          {tier.jobs.length ? (
            <div data-sys-jobs>
              <JobRows jobs={tier.jobs} />
            </div>
          ) : (
            <Empty>No jobs yet.</Empty>
          )}
          <div style={label}>Pull requests</div>
          {tier.prs.length ? (
            <div className="bg-transparent text-[var(--ic-ink)]" data-sys-prs>
              <ChatArtifacts artifacts={tier.prs.map((p) => p.artifact)} versions={NO_VERSIONS} />
            </div>
          ) : (
            <Empty>None yet.</Empty>
          )}
          <div style={label}>Decisions</div>
          {tier.decisions.length ? (
            tier.decisions.map((d) => (
              <div key={d.id} data-sys-decision={d.id} style={{ fontFamily: TYPE, fontSize: 13 }}>
                <span style={{ color: d.decided ? v("done") : v("fork") }}>{d.decided ? "✓ " : "? "}</span>
                {d.name}
              </div>
            ))
          ) : (
            <Empty>No brainstorm about it.</Empty>
          )}
          <div style={label}>Where it stands</div>
          <Affordances tier={tier} model={model} edits={edits} />
        </>
      ) : (
        <>
          {[...stack].reverse().map((t) => (
            <div
              key={t.id}
              data-sys-stack-tier={t.id}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${t.id === tier.id ? v("here") : v("border")}`,
                background: t.id === tier.id ? a("road", 8) : "transparent",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <button
                type="button"
                onClick={() => onPick(t.id)}
                style={{ all: "unset", cursor: "pointer", fontFamily: TYPE, fontSize: 15, fontWeight: 600 }}
              >
                {t.name}
              </button>
              <TierBlock tier={t} />
            </div>
          ))}
          <button type="button" onClick={onDeeper} style={pill(13)} data-sys-deeper>
            Jobs, pull requests and decisions →
          </button>
          <Affordances tier={tier} model={model} edits={edits} />
        </>
      )}
    </div>
  );
}

const Empty = ({ children }: { children: string }) => (
  <div style={{ fontFamily: TYPE, fontSize: 13, color: v("faint"), fontStyle: "italic" }}>{children}</div>
);

/** The List view: the same model, by district, tiers as rows with their three states. */
export function SystemList({
  model,
  onPick,
}: {
  model: SystemModel;
  onPick: (id: string) => void;
}) {
  const districts = model.zones.flatMap((z) => z.districts.map((d) => ({ zone: z.label, d })));
  return (
    <div
      data-sys-list
      data-sys-panel
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        inset: 0,
        paddingTop: 70,
        paddingBottom: 150,
        overflowY: "auto",
        zIndex: 10,
        background: v("desk"),
      }}
    >
      <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, padding: "0 16px" }}>
        {districts.map(({ zone, d }) => (
          <section
            key={d.id}
            data-sys-list-district={d.id}
            style={{ border: `1px solid ${v("sysCellBorder")}`, background: v("sysCell"), borderRadius: 10, padding: 14 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <div style={{ fontFamily: TYPE, fontSize: 18, fontWeight: 600 }}>
                {d.name} <span style={{ ...label, marginLeft: 8 }}>{zone}</span>
              </div>
              <div style={{ fontFamily: TYPE, fontSize: 12.5, color: v("muted") }}>
                {d.rollup.attention ? <span style={{ color: v("blocked") }}>! </span> : null}
                {rollupLine(d.rollup)}
              </div>
            </div>
            {d.stacks.length ? (
              d.stacks.flat().map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-sys-list-tier={t.id}
                  data-tier-state={t.state}
                  onClick={() => onPick(t.id)}
                  style={{
                    all: "unset",
                    boxSizing: "border-box",
                    width: "100%",
                    cursor: "pointer",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: "6px 0",
                    borderTop: `1px solid ${a("road", 12)}`,
                    fontFamily: TYPE,
                    fontSize: 14,
                  }}
                >
                  <span
                    style={{ ...tierLook(t.state), width: 92, textAlign: "center", borderRadius: 6, fontSize: 12, padding: "2px 0" }}
                  >
                    {STATE_LABEL[t.state]}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {t.extendsId ? "↳ " : ""}
                    {t.name}
                  </span>
                  <span style={{ color: v("muted"), fontSize: 12.5 }}>
                    {t.people.map((p) => p.name).join(", ")}
                    {t.blocked ? " · !" : ""}
                  </span>
                </button>
              ))
            ) : (
              <Empty>No features stand here yet.</Empty>
            )}
          </section>
        ))}
        <section
          data-sys-list-unmapped
          style={{ border: `1.5px dashed ${v("sysUnmapped")}`, background: v("sysUnmappedBg"), borderRadius: 10, padding: 14 }}
        >
          <div style={{ fontFamily: TYPE, fontSize: 18, fontWeight: 600 }}>Unmapped</div>
          {model.unmapped.jobs.length || model.unmapped.prs.length ? (
            <>
              <JobRows jobs={model.unmapped.jobs} />
              {model.unmapped.prs.map((p) => (
                <div key={p.artifact.id} style={{ fontFamily: TYPE, fontSize: 13, padding: "3px 0" }}>
                  {p.artifact.title}
                </div>
              ))}
            </>
          ) : (
            <Empty>Every job and pull request builds a feature.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}
