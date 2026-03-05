"use client";

import { useState } from "react";
import FinalVariation from "./FinalVariation";
import PlanButtonA from "./PlanButtonA";
import PlanButtonB from "./PlanButtonB";
import PlanButtonC from "./PlanButtonC";

const VARIATIONS = [
  {
    id: "ref",
    label: "Reference",
    desc: 'Current state — "Create Feature" with Lightbulb icon',
  },
  {
    id: "A",
    label: "A — Wand + Generate Plan",
    desc: "Wand2 icon, label becomes \"Generate Plan\". Clean 1-to-1 swap — same pill shape, different icon & copy.",
  },
  {
    id: "B",
    label: "B — Sparkles + animated",
    desc: "Sparkles icon with a subtle shimmer animation on the pill to signal AI generation. Label \"Generate Plan\".",
  },
  {
    id: "C",
    label: "C — Split: icon morphs on hover",
    desc: "Shows Lightbulb at rest, morphs to Map icon on hover — label slides from \"Create Feature\" to \"Generate Plan\" inline.",
  },
];

export default function GraphChatPrototypePage() {
  const [active, setActive] = useState("A");

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Prototype nav */}
      <div className="shrink-0 z-50 flex items-center gap-3 px-4 py-2 border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Prototype · Generate Plan Button
        </span>
        <div className="flex-1" />
        {VARIATIONS.map((v) => (
          <button
            key={v.id}
            onClick={() => setActive(v.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
              active === v.id
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Description strip */}
      <div className="shrink-0 px-4 py-1.5 bg-muted/30 border-b border-border/30">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {VARIATIONS.find((v) => v.id === active)?.label}
          </span>
          {" — "}
          {VARIATIONS.find((v) => v.id === active)?.desc}
        </p>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 relative">
        {active === "ref" && <FinalVariation />}
        {active === "A" && <PlanButtonA />}
        {active === "B" && <PlanButtonB />}
        {active === "C" && <PlanButtonC />}
      </div>
    </div>
  );
}
