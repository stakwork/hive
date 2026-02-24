"use client";

import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { SaveIndicator } from "@/components/features/SaveIndicator";
import { Edit, Eye } from "lucide-react";

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
  onSectionSave?: (field: string, value: string) => Promise<void>;
  savedField?: string | null;
  saving?: boolean;
  saved?: boolean;
}

function EditableSection({
  section,
  onSave,
  savedField,
  saving,
  saved,
}: {
  section: PlanSection;
  onSave?: (key: string, content: string) => void;
  savedField: string | null;
  saving: boolean;
  saved: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.content ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startEditing = useCallback(() => {
    setDraft(section.content ?? "");
    setEditing(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [section.content]);

  const finishEditing = useCallback(() => {
    setEditing(false);
    if (draft !== section.content && onSave) {
      onSave(section.key, draft);
    }
  }, [draft, section.content, section.key, onSave]);

  const isEditable = !!onSave;

  return (
    <div className="group/section">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
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
        {isEditable && !editing && (
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
            className="resize-y font-mono text-sm min-h-[120px] pr-10"
          />
        </div>
      ) : (
        <MarkdownRenderer size="compact">{section.content!}</MarkdownRenderer>
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
}: PlanArtifactPanelProps) {
  const { sections } = planData;
  const filledSections = sections.filter((s) => s.content);

  const handleSectionSave = useCallback(
    (key: string, content: string) => {
      onSectionSave?.(key, content);
    },
    [onSectionSave],
  );

  if (filledSections.length === 0) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground/40">Plan will appear as the conversation progresses</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ScrollArea className="flex-1 min-h-0">
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
                <EditableSection
                  section={section}
                  onSave={onSectionSave ? handleSectionSave : undefined}
                  savedField={savedField}
                  saving={saving}
                  saved={saved}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}
