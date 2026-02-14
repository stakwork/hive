"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquarePlus, Edit2, Trash2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface Highlight {
  id: string;
  text: string;
  comment: string;
  range: {
    start: number;
    end: number;
  };
}

interface TextHighlighterProps {
  children: React.ReactNode;
  highlights: Highlight[];
  onHighlightsChange: (highlights: Highlight[]) => void;
}

export function TextHighlighter({
  children,
  highlights,
  onHighlightsChange,
}: TextHighlighterProps) {
  const [selectedText, setSelectedText] = useState("");
  const [selectionRange, setSelectionRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editingHighlight, setEditingHighlight] = useState<Highlight | null>(
    null
  );
  const [commentValue, setCommentValue] = useState("");
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);

  const getTextContent = useCallback((): string => {
    if (!contentRef.current) return "";
    return contentRef.current.innerText || contentRef.current.textContent || "";
  }, []);

  const checkOverlap = useCallback(
    (start: number, end: number): boolean => {
      return highlights.some(
        (h) =>
          (start >= h.range.start && start < h.range.end) ||
          (end > h.range.start && end <= h.range.end) ||
          (start <= h.range.start && end >= h.range.end)
      );
    },
    [highlights]
  );

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length === 0) {
      setPopoverOpen(false);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Calculate position relative to viewport
    setPopoverPosition({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });

    // Get the full text content
    const fullText = getTextContent();
    const selectedTextInContent = selectedText;

    // Find the position of selected text in the full content
    // Note: This is a simplified approach for text position tracking
    const startOffset = fullText.indexOf(selectedTextInContent);
    if (startOffset === -1) return;

    const endOffset = startOffset + selectedTextInContent.length;

    // Check for overlaps
    if (checkOverlap(startOffset, endOffset)) {
      // Don't allow overlapping selections
      selection.removeAllRanges();
      return;
    }

    setSelectedText(selectedTextInContent);
    setSelectionRange({ start: startOffset, end: endOffset });
    setPopoverOpen(true);
    setEditingHighlight(null);
    setCommentValue("");
  }, [getTextContent, checkOverlap]);

  useEffect(() => {
    const handleMouseUp = () => {
      // Small delay to ensure selection is complete
      setTimeout(handleTextSelection, 10);
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleTextSelection]);

  const handleSaveComment = () => {
    if (!commentValue.trim()) return;

    if (editingHighlight) {
      // Update existing highlight
      const updatedHighlights = highlights.map((h) =>
        h.id === editingHighlight.id ? { ...h, comment: commentValue.trim() } : h
      );
      onHighlightsChange(updatedHighlights);
    } else if (selectionRange) {
      // Create new highlight
      const newHighlight: Highlight = {
        id: `highlight-${Date.now()}-${Math.random()}`,
        text: selectedText,
        comment: commentValue.trim(),
        range: selectionRange,
      };
      onHighlightsChange([...highlights, newHighlight]);
    }

    // Clear selection
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    setPopoverOpen(false);
    setCommentValue("");
    setSelectedText("");
    setSelectionRange(null);
    setEditingHighlight(null);
  };

  const handleCancelComment = () => {
    setPopoverOpen(false);
    setCommentValue("");
    setSelectedText("");
    setSelectionRange(null);
    setEditingHighlight(null);

    // Clear selection
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
  };

  const handleDeleteHighlight = (highlightId: string) => {
    const updatedHighlights = highlights.filter((h) => h.id !== highlightId);
    onHighlightsChange(updatedHighlights);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSaveComment();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelComment();
    }
  };

  return (
    <div className="relative" style={{ userSelect: "text" }}>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverAnchor
          style={{
            position: "fixed",
            left: popoverPosition.x,
            top: popoverPosition.y,
            pointerEvents: "none",
          }}
        />
        <PopoverContent
          side="top"
          className="w-80 p-4 z-[100]"
          onInteractOutside={handleCancelComment}
        >
          <div className="space-y-3">
            {editingHighlight ? (
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Edit2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Edit Comment</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleDeleteHighlight(editingHighlight.id)}
                  className="h-8 w-8 p-0"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Add Comment</span>
              </div>
            )}

            {selectedText && !editingHighlight && (
              <div className="text-xs text-muted-foreground bg-muted p-2 rounded-md max-h-20 overflow-y-auto">
                &quot;{selectedText.length > 100 ? selectedText.substring(0, 100) + "..." : selectedText}&quot;
              </div>
            )}

            <Textarea
              placeholder="Enter your comment..."
              value={commentValue}
              onChange={(e) => setCommentValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[80px] resize-none"
              autoFocus
            />

            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancelComment}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveComment}
                disabled={!commentValue.trim()}
              >
                Save
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <div ref={contentRef} className="select-text">
        {children}
      </div>

      {/* Render highlight markers as overlays */}
      {highlights.map((highlight) => (
        <div
          key={highlight.id}
          className="hidden"
          data-highlight-id={highlight.id}
          data-highlight-start={highlight.range.start}
          data-highlight-end={highlight.range.end}
          data-highlight-text={highlight.text}
          data-highlight-comment={highlight.comment}
        />
      ))}
    </div>
  );
}

export default TextHighlighter;
