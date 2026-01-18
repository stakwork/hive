"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Send, Lightbulb, Image as ImageIcon, X, Eye } from "lucide-react";

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
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

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
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit(e);
    }
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
      className="relative flex justify-center items-center gap-2 w-full px-4 py-4"
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

      {/* Image upload button */}
      <div className="relative">
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
          className={`relative h-10 w-10 rounded-full border-2 transition-all overflow-hidden ${
            imageData
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

      <div className="relative w-full max-w-[70vw] sm:max-w-[450px] md:max-w-[500px] lg:max-w-[600px]">
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask me about your codebase..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          className={`w-full px-4 py-3 pr-12 rounded-full bg-background/5 border border-border/20 text-sm text-foreground/95 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || disabled}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full"
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
          className="rounded-full h-10 w-10"
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
          className="rounded-full h-10 w-10"
          title={isProvenanceSidebarOpen ? "Hide sources" : "Show sources"}
        >
          <Eye className={`w-4 h-4 ${isProvenanceSidebarOpen ? "text-primary" : ""}`} />
        </Button>
      )}
    </form>
  );
}
