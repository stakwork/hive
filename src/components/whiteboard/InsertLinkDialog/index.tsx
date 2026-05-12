"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface InsertLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (url: string, label: string) => void;
}

export function InsertLinkDialog({ open, onOpenChange, onInsert }: InsertLinkDialogProps) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [urlError, setUrlError] = useState("");

  // Reset form whenever the dialog closes
  useEffect(() => {
    if (!open) {
      setUrl("");
      setLabel("");
      setUrlError("");
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError("");

    try {
      new URL(url);
    } catch {
      setUrlError("Please enter a valid URL (e.g. https://example.com)");
      return;
    }

    onInsert(url, label.trim() || url);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert link</DialogTitle>
          <DialogDescription>
            Add a clickable link object to the canvas.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label htmlFor="link-url" className="text-sm font-medium">
              URL <span className="text-destructive">*</span>
            </label>
            <Input
              id="link-url"
              type="text"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (urlError) setUrlError("");
              }}
              autoFocus
            />
            {urlError && (
              <p className="text-xs text-destructive">{urlError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="link-label" className="text-sm font-medium">
              Label
            </label>
            <Input
              id="link-label"
              type="text"
              placeholder="Defaults to URL"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!url}>
              Insert
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
