"use client";

import { Button } from "@/components/ui/button";
import { Eye, Image as ImageIcon, Lightbulb, Plus, Send, Share2, X } from "lucide-react";
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

const MAX_EXTRA_WORKSPACES = 4; // current + 4 = 5 total

interface ChatInputProps {
  onSend: (message: string, clearInput: () => void) => Promise<void>;
  disabled?: boolean;
  showCreateFeature?: boolean;
  onCreateFeature?: () => void;
  isCreatingFeature?: boolean;
  imageData?: string | null;
  onImageUpload?: (imageData: string) => void;
  onImageRemove?: () => void;
  showProvenanceToggle?: boolean;
  isProvenanceSidebarOpen?: boolean;
  onToggleProvenance?: () => void;
  showShareButton?: boolean;
  onShare?: () => void;
  extraWorkspaceSlugs?: string[];
  onAddWorkspace?: (slug: string) => void;
  onRemoveWorkspace?: (slug: string) => void;
  currentWorkspaceSlug?: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  showCreateFeature = false,
  onCreateFeature,
  isCreatingFeature = false,
  imageData = null,
  onImageUpload,
  onImageRemove,
  showProvenanceToggle = false,
  isProvenanceSidebarOpen = false,
  onToggleProvenance,
  showShareButton = false,
  onShare,
  extraWorkspaceSlugs = [],
  onAddWorkspace,
  onRemoveWorkspace,
  currentWorkspaceSlug,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [rows, setRows] = useState(1);
  const [isWorkspacePickerOpen, setIsWorkspacePickerOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const { workspaces } = useWorkspace();

  const isAtLimit = extraWorkspaceSlugs.length >= MAX_EXTRA_WORKSPACES;

  const availableWorkspaces = workspaces.filter(
    (ws) =>
      ws.slug !== currentWorkspaceSlug &&
      !extraWorkspaceSlugs.includes(ws.slug)
  );

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
    // Don't clear input yet - wait for response to start
    await onSend(message, () => {
      setInput("");
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

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    if (disabled) return;

    const file = e.dataTransfer.files[0];
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
  };

  return (
    <form
      onSubmit={handleSubmit}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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
              {isAtLimit ? "Maximum 5 workspaces" : "Add workspace"}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={rows}
            className={`w-full px-4 py-3 pr-12 rounded-2xl bg-background/5 border border-border/20 text-sm text-foreground/95 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none ${disabled ? "opacity-50 cursor-not-allowed" : ""
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
        {showCreateFeature && (
          <Button
            type="button"
            onClick={onCreateFeature}
            disabled={isCreatingFeature || disabled}
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full h-10 w-10"
            title="Create Feature"
          >
            <Lightbulb className="w-4 h-4" />
          </Button>
        )}
        {showProvenanceToggle && (
          <Button
            type="button"
            onClick={onToggleProvenance}
            disabled={disabled}
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full h-10 w-10"
            title={isProvenanceSidebarOpen ? "Hide sources" : "Show sources"}
          >
            <Eye className={`w-4 h-4 ${isProvenanceSidebarOpen ? "text-primary" : ""}`} />
          </Button>
        )}
        {showShareButton && (
          <Button
            type="button"
            onClick={onShare}
            disabled={disabled}
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full h-10 w-10"
            title="Share conversation"
          >
            <Share2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
