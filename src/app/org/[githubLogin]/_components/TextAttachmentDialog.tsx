"use client";

import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Loaded =
  | { state: "loading" }
  | { state: "ready"; text: string; truncated: boolean }
  | { state: "error"; message: string };

/**
 * A text attachment (a call's transcript excerpt, a note) read in place.
 * The text comes from `/api/upload/text` on Hive's own origin: the
 * presigned S3 link, opened as a page, trips Chrome's lookalike-domain
 * warning. Shown in a `<pre>`, never rendered, so an uploaded file is only
 * ever text here. Download stays one click away.
 */
export function TextAttachmentDialog({
  attachment,
  onClose,
}: {
  attachment: { path: string; filename: string } | null;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const path = attachment?.path;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoaded({ state: "loading" });
    fetch(`/api/upload/text?s3Key=${encodeURIComponent(path)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoaded({ state: "error", message: body.error || "Could not open the file" });
          return;
        }
        setLoaded({ state: "ready", text: String(body.text ?? ""), truncated: body.truncated === true });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ state: "error", message: "Could not open the file" });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <Dialog open={attachment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl" data-testid="text-attachment-dialog">
        <DialogHeader className="flex-row items-center justify-between gap-3 pr-8">
          <DialogTitle className="truncate text-sm">{attachment?.filename}</DialogTitle>
          {attachment && (
            <a
              href={`/api/upload/presigned-url?s3Key=${encodeURIComponent(attachment.path)}`}
              download={attachment.filename}
              className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
          )}
        </DialogHeader>
        {loaded.state === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
        {loaded.state === "error" && <p className="text-sm text-destructive">{loaded.message}</p>}
        {loaded.state === "ready" && (
          <>
            <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
              {loaded.text}
            </pre>
            {loaded.truncated && (
              <p className="text-xs text-muted-foreground">Only the start is shown. Download the file for the rest.</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
