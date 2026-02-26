"use client";

import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { SaveIndicator } from "@/components/features/SaveIndicator";
import { Edit, Eye, FileText, Users, ListChecks, Cpu } from "lucide-react";

export interface PlanSection {
  key: string;
  label: string;
  content: string | null;
}

export interface PlanData {
  featureTitle: string | null;
  sections: PlanSection[];
}

export type DiffToken = { word: string; isNew: boolean };
export type SectionHighlight =
  | { type: "new" }
  | { type: "diff"; tokens: DiffToken[] };
export type SectionHighlights = Record<string, SectionHighlight>;

interface PlanArtifactPanelProps {
  planData: PlanData;
  onSectionSave?: (field: string, value: string) => Promise<void>;
  savedField?: string | null;
  saving?: boolean;
  saved?: boolean;
  sectionHighlights?: SectionHighlights | null;
}

const SECTION_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; placeholder: string; hint: string }
> = {
  brief: {
    icon: FileText,
    placeholder: "Describe the feature in a few sentences...",
    hint: "What is this feature and why does it matter?",
  },
  "user-stories": {
    icon: Users,
    placeholder: "As a user, I want to...\nAs an admin, I want to...",
    hint: "Who uses this and what do they need?",
  },
  requirements: {
    icon: ListChecks,
    placeholder: "- Must support...\n- Should handle...\n- Performance target...",
    hint: "What are the functional and non-functional requirements?",
  },
  architecture: {
    icon: Cpu,
    placeholder: "## Components\n\n## Data Flow\n\n## API Design",
    hint: "How will this be built technically?",
  },
};

function EditableSection({
  section,
  onSave,
  savedField,
  saving,
  saved,
  highlight,
}: {
  section: PlanSection;
  onSave?: (key: string, content: string) => void;
  savedField: string | null;
  saving: boolean;
  saved: boolean;
  highlight?: SectionHighlight | null;
}) {
  const hasContent = !!section.content;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.content ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEditable = !!onSave;
  const meta = SECTION_META[section.key];
  const SectionIcon = meta?.icon;

  const startEditing = useCallback(() => {
    setDraft(section.content ?? "");
    setEditing(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [section.content]);

  const finishEditing = useCallback(() => {
    setEditing(false);
    if (draft !== (section.content ?? "") && onSave) {
      onSave(section.key, draft);
    }
  }, [draft, section.content, section.key, onSave]);

  return (
    <div className="group/section">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-2">
        {SectionIcon && (
          <SectionIcon className="h-3.5 w-3.5 text-emerald-500/80 shrink-0" />
        )}
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {section.label}
        </h3>
        {isEditable && !editing && (
          <SaveIndicator
            field={section.key}
            savedField={savedField}
            saving={saving}
            saved={saved}
          />
        )}
        {isEditable && !editing && hasContent && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={startEditing}
            className="opacity-0 group-hover/section:opacity-100 transition-opacity h-6 w-6 ml-auto"
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Editing state */}
      {editing ? (
        <div className="relative">
          <div className="sticky top-0 z-10 h-0 flex justify-end pointer-events-none">
            <Button
              size="sm"
              variant="secondary"
              onClick={finishEditing}
              className="pointer-events-auto h-7 w-7 p-0 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-background/90 mt-1.5 mr-1.5"
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finishEditing}
            placeholder={meta?.placeholder}
            className="resize-y font-mono text-sm min-h-[120px] pr-10"
          />
        </div>
      ) : hasContent ? (
        /* Filled state - render markdown with optional highlights */
        highlight?.type === "new" ? (
          <motion.div
            initial={{ boxShadow: "0 0 14px rgba(16,185,129,0.35)", outline: "2px solid rgba(16,185,129,0.5)" }}
            animate={{ boxShadow: "0 0 0px rgba(16,185,129,0)", outline: "2px solid rgba(16,185,129,0)" }}
            transition={{ duration: 3, ease: "easeOut" }}
            className="rounded-lg"
          >
            <MarkdownRenderer size="compact">{section.content!}</MarkdownRenderer>
          </motion.div>
        ) : highlight?.type === "diff" ? (
          <div className="text-sm leading-relaxed">
            {highlight.tokens.map((token, i) =>
              token.isNew ? (
                <motion.span
                  key={i}
                  initial={{ backgroundColor: "rgba(52, 211, 153, 0.3)" }}
                  animate={{ backgroundColor: "rgba(52, 211, 153, 0)" }}
                  transition={{ duration: 3, ease: "easeOut" }}
                  className="rounded-sm px-0.5"
                >
                  {token.word}
                </motion.span>
              ) : (
                <span key={i}>{token.word}</span>
              )
            )}
          </div>
        ) : (
          <MarkdownRenderer size="compact">{section.content!}</MarkdownRenderer>
        )
      ) : isEditable ? (
        /* Empty editable state - inviting click target */
        <button
          type="button"
          onClick={startEditing}
          className="w-full text-left rounded-lg border border-dashed border-border/60 hover:border-emerald-500/40 bg-muted/20 hover:bg-emerald-500/[0.03] transition-all duration-200 cursor-text group/empty"
        >
          <div className="px-4 py-4">
            <p className="text-sm text-muted-foreground/50 group-hover/empty:text-muted-foreground/70 transition-colors leading-relaxed">
              {meta?.hint || `Add ${section.label.toLowerCase()}...`}
            </p>
            <p className="text-xs text-muted-foreground/30 group-hover/empty:text-muted-foreground/50 transition-colors mt-1.5">
              Click to start writing
            </p>
          </div>
        </button>
      ) : (
        /* Empty read-only state */
        <div className="rounded-lg border border-dashed border-border/40 bg-muted/10 px-4 py-4">
          <p className="text-sm text-muted-foreground/30 italic">
            No {section.label.toLowerCase()} yet
          </p>
        </div>
      )}
    </div>
  );
}

export function PlanArtifactPanel({
  planData,
  onSectionSave,
  savedField = null,
  saving = false,
  saved = false,
  sectionHighlights = null,
}: PlanArtifactPanelProps) {
  const { sections } = planData;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-5 py-4">
          <AnimatePresence initial={false}>
            {sections.map((section, i) => (
              <motion.div
                key={section.key}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="overflow-hidden"
              >
                {i > 0 && <div className="border-b my-5" />}
                <EditableSection
                  section={section}
                  onSave={onSectionSave}
                  savedField={savedField}
                  saving={saving}
                  saved={saved}
                  highlight={sectionHighlights?.[section.key] ?? null}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}
