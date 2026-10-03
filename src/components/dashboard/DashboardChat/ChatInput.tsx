"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, Plus, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WorkspacePills } from "./WorkspacePills";
import { useFileDrop } from "@/hooks/useFileDrop";
import { getDraft, setDraft, type DraftScope } from "@/lib/conversationDrafts";

const DEFAULT_MAX_EXTRA_WORKSPACES = 4; // current + 4 = 5 total

interface ChatInputProps {
  /**
   * State-backed identity: the loaded server conversation id, or `__new__`
   * while unsaved. Changing it saves the previous draft and restores the
   * next one. Not the send ref — that does not re-render.
   */
  conversationKey?: string;
  draftScope?: DraftScope | null;
  /** Fired after a draft is saved so Recent Chats can show the unsaved row. */
  onDraftChange?: () => void;
  onSend: (message: string, clearInput: () => void) => Promise<void>;
  disabled?: boolean;
  imageData?: string | null;
  onImageUpload?: (imageData: string) => void;
  onImageRemove?: () => void;
  extraWorkspaceSlugs?: string[];
  onAddWorkspace?: (slug: string) => void;
  onRemoveWorkspace?: (slug: string) => void;
  currentWorkspaceSlug?: string;
  maxExtraWorkspaces?: number;
}

export function ChatInput({
  conversationKey,
  draftScope = null,
  onDraftChange,
  onSend,
  disabled = false,
  imageData = null,
  onImageUpload,
  onImageRemove,
  extraWorkspaceSlugs = [],
  onAddWorkspace,
  onRemoveWorkspace,
  currentWorkspaceSlug,
  maxExtraWorkspaces = DEFAULT_MAX_EXTRA_WORKSPACES,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState(1);
  const inputValueRef = useRef("");
  const scopeRef = useRef<DraftScope | null>(draftScope);
  scopeRef.current = draftScope;
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  const [isWorkspacePickerOpen, setIsWorkspacePickerOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { workspaces } = useWorkspace();

  const isAtLimit = extraWorkspaceSlugs.length >= maxExtraWorkspaces;
  const totalLimit = Number.isFinite(maxExtraWorkspaces) ? maxExtraWorkspaces + 1 : null;

  const availableWorkspaces = workspaces.filter(
    (ws) =>
      ws.slug !== currentWorkspaceSlug &&
      !extraWorkspaceSlugs.includes(ws.slug)
  );

  // Save the previous conversation's text and restore the next one's.
  // `get` runs in an effect, never during render. `__new__` stays in
  // memory only — `setDraft` refuses to write it to localStorage.
  const skipDraftNotify = useRef(true);
  useEffect(() => {
    if (!conversationKey || !draftScope) return;
    const restored = getDraft(draftScope, { allowStorage: true });
    inputValueRef.current = restored;
    setInput(restored);
    skipDraftNotify.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey]);

  useEffect(() => {
    return () => {
      const scope = scopeRef.current;
      if (!scope) return;
      setDraft(scope, inputValueRef.current);
      onDraftChangeRef.current?.();
    };
  }, []);

  // Auto-adjust textarea height based on content
  useEffect(() => {
    if (!input) {
      setRows(1);
      return;
    }

    // Count newlines in the text
    const lineCount = (input.match(/\n/g) || []).length + 1;
    // Set rows to lineCount + 1 (one empty row below)
    setRows(Math.max(1, lineCount + 1));
  }, [input]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;

    const message = input.trim();
    // Don't clear input yet - wait for response to start. The parent
    // calls `clearInput` only on the first stream chunk (ask success).
    await onSend(message, () => {
      inputValueRef.current = "";
      setInput("");
      if (draftScope) setDraft(draftScope, "");
      onDraftChange?.();
      inputRef.current?.focus();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // Regular Enter submits the form
      e.preventDefault();
      handleSubmit(e);
    }
    // Shift+Enter allows default behavior (new line)
  };

  const convertToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }

    try {
      const base64 = await convertToBase64(file);
      onImageUpload?.(base64);
    } catch (error) {
      console.error("Error reading file:", error);
      alert("Failed to read image file");
    }
  };

  const handleRemoveImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    onImageRemove?.();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const { isDragging, dragProps } = useFileDrop({
    disabled,
    onDrop: async (files) => {
      const file = files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        alert("Please drop an image file");
        return;
      }
      try {
        const base64 = await convertToBase64(file);
        onImageUpload?.(base64);
      } catch (error) {
        console.error("Error reading file:", error);
        alert("Failed to read image file");
      }
    },
  });

  return (
    <form
      onSubmit={handleSubmit}
      {...dragProps}
      className="relative flex flex-col items-center gap-1 w-full px-4 py-4 -mb-4"
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-2xl flex items-center justify-center pointer-events-none z-10">
          <div className="bg-background/90 px-6 py-3 rounded-lg shadow-lg">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              Drop image here
            </p>
          </div>
        </div>
      )}

      {/* Workspace pills row */}
      <WorkspacePills
        slugs={extraWorkspaceSlugs}
        onRemove={(slug) => onRemoveWorkspace?.(slug)}
      />

      {/* Input controls row */}
      <div className="flex justify-center items-center gap-2 w-full max-w-[70vw] sm:max-w-[550px] md:max-w-[620px] lg:max-w-[720px] mx-auto">
        {/* Add workspace button */}
        <Popover open={isWorkspacePickerOpen} onOpenChange={setIsWorkspacePickerOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={disabled || isAtLimit}
                  className={`shrink-0 h-10 w-10 rounded-full border-2 border-border/20 hover:border-primary/50 bg-background/5 transition-all flex items-center justify-center ${
                    disabled || isAtLimit ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                  }`}
                >
                  <Plus className="w-4 h-4 text-muted-foreground" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              {isAtLimit && totalLimit !== null ? `Maximum ${totalLimit} workspaces` : "Add workspace"}
            </TooltipContent>
          </Tooltip>

          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search workspaces..." />
              <CommandList>
                <CommandEmpty>No workspaces found</CommandEmpty>
                {availableWorkspaces.map((ws) => (
                  <CommandItem
                    key={ws.slug}
                    onSelect={() => {
                      onAddWorkspace?.(ws.slug);
                      setIsWorkspacePickerOpen(false);
                    }}
                  >
                    {ws.name}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Image upload button */}
        <div className="relative shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileInput}
            className="hidden"
            disabled={disabled}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className={`relative h-10 w-10 rounded-full border-2 transition-all overflow-hidden ${imageData
              ? "border-primary"
              : "border-border/20 hover:border-primary/50 bg-background/5"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            title={imageData ? "Click to change image" : "Upload image"}
          >
            {imageData ? (
              <>
                <img
                  src={imageData}
                  alt="Uploaded"
                  className="w-full h-full object-cover"
                />
                <div
                  onClick={handleRemoveImage}
                  className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center"
                >
                  <X className="w-4 h-4 text-white" />
                </div>
              </>
            ) : (
              <ImageIcon className="w-4 h-4 m-auto text-muted-foreground" />
            )}
          </button>
        </div>

        <div className="relative flex-1 min-w-0 leading-none">
          <textarea
            ref={inputRef}
            placeholder="Ask me about your codebase..."
            value={input}
            onChange={(e) => {
              const next = e.target.value;
              inputValueRef.current = next;
              setInput(next);
              if (draftScope) setDraft(draftScope, next);
              if (skipDraftNotify.current) {
                skipDraftNotify.current = false;
                return;
              }
              onDraftChange?.();
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={rows}
            className={`w-full px-4 py-3 pr-12 rounded-2xl bg-background/90 border border-border/50 text-sm text-foreground/95 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none ${disabled ? "opacity-50 cursor-not-allowed" : ""
              }`}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || disabled}
            className="absolute right-1.5 bottom-2.5 h-8 w-8 rounded-full"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </form>
  );
}
