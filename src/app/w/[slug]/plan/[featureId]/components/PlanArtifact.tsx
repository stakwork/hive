"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

export interface PlanSection {
  key: string;
  label: string;
  content: string | null;
}

export interface PlanData {
  featureTitle: string | null;
  sections: PlanSection[];
}

interface PlanArtifactPanelProps {
  planData: PlanData;
}

export function PlanArtifactPanel({ planData }: PlanArtifactPanelProps) {
  const { featureTitle, sections } = planData;
  const filledSections = sections.filter((s) => s.content);

  if (filledSections.length === 0) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-5 py-3 border-b shrink-0">
          <h2 className="text-sm font-semibold text-foreground">{featureTitle}</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground/40">Plan will appear as the conversation progresses</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-5 py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold text-foreground">{featureTitle}</h2>
      </div>
      <div className="flex-1 min-h-0 relative">
        <ScrollArea className="absolute inset-0">
          <div className="px-5 py-4">
            <AnimatePresence initial={false}>
              {filledSections.map((section, i) => (
                <motion.div
                  key={section.key}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  {i > 0 && <div className="border-b my-5" />}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{section.label}</h3>
                  </div>
                  <MarkdownRenderer size="compact">{section.content!}</MarkdownRenderer>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
