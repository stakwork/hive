"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Pencil, Eye, Check } from "lucide-react";

interface ActiveItem {
  type: "doc" | "concept";
  repoName?: string;
  id?: string;
  name: string;
  content: string;
}

interface LearnDocViewerProps {
  activeItem: ActiveItem | null;
  onSave: (content: string) => Promise<void>;
  isSaving: boolean;
}

export function LearnDocViewer({
  activeItem,
  onSave,
  isSaving,
}: LearnDocViewerProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (activeItem) {
      setEditedContent(activeItem.content);
      setIsEditMode(false);
    }
  }, [activeItem]);

  const handleEnterEditMode = () => {
    setIsEditMode(true);
    setEditedContent(activeItem?.content || "");
  };

  const handleExitEditMode = () => {
    setIsEditMode(false);
    setEditedContent(activeItem?.content || "");
  };

  const handleSaveClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmSave = async () => {
    try {
      await onSave(editedContent);
      setShowConfirm(false);
      setIsEditMode(false);
    } catch (error) {
      console.error("Failed to save:", error);
    }
  };

  const handleCancelSave = () => {
    setShowConfirm(false);
  };

  if (!activeItem) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a document or concept to view
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with title and controls */}
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <h1 className="text-2xl font-semibold">{activeItem.name}</h1>
          <p className="text-sm text-muted-foreground">
            {activeItem.type === "doc" ? "Documentation" : "Concept"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isEditMode ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSaveClick}
                disabled={isSaving}
                className="text-green-600 hover:text-green-700 hover:bg-green-50"
                title="Save"
                data-testid="learn-save-button"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleExitEditMode}
                disabled={isSaving}
                title="Preview"
                data-testid="learn-view-button"
              >
                <Eye className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleEnterEditMode}
              title="Edit"
              data-testid="learn-edit-button"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-6" data-testid="learn-content-area">
        {isEditMode ? (
          <Textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="w-full h-full min-h-[500px] font-mono text-sm resize-none"
            placeholder="Enter documentation content..."
            data-testid="learn-content-editor"
          />
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="learn-content-view">
            <MarkdownRenderer>{activeItem.content}</MarkdownRenderer>
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={showConfirm}
        onOpenChange={setShowConfirm}
        onConfirm={handleConfirmSave}
        title="Save changes?"
        description="This will update the documentation. Are you sure?"
        testId="learn-doc-save-confirm"
        confirmText="Save"
      />
    </div>
  );
}
