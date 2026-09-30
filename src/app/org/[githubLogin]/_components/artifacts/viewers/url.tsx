"use client";

import React, { useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, RotateCw } from "lucide-react";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { addressParts, webAddress } from "../address";
import { PanelToolbar, ToolbarButton } from "../chrome";

/**
 * A page from elsewhere may run and post forms, and keeps its own origin
 * (so its own sign-in works), but it cannot navigate Hive's tab away. A
 * page on Hive's own origin is Hive itself: the frame confines it no more
 * than a tab of its own would.
 */
const BROWSER_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups";

export function UrlInline({ content }: ArtifactViewerProps<"url">) {
  const { host, rest } = addressParts(content.url);
  return (
    <div className="px-3 py-2.5">
      <div className="truncate rounded-full border bg-background px-3 py-1 font-mono text-[11px]">
        {host}
        <span className="text-muted-foreground">{rest}</span>
      </div>
    </div>
  );
}

/**
 * A small browser on the artifact's address: an address bar, reload, and
 * back and forward over the addresses entered here. Links followed inside
 * the page are the page's own business — a frame does not report them.
 */
export function UrlPanel({ artifact, content }: ArtifactViewerProps<"url">) {
  const [history, setHistory] = useState<string[]>(() => {
    const start = webAddress(content.url);
    return start ? [start] : [];
  });
  const [index, setIndex] = useState(0);
  const [reloads, setReloads] = useState(0);
  const [loading, setLoading] = useState(true);
  const current: string | undefined = history[index];
  const [address, setAddress] = useState(current ?? content.url);

  /** Puts `entries[at]` in the frame, and in the address bar as it was made whole. */
  const show = (entries: string[], at: number) => {
    setHistory(entries);
    setIndex(at);
    setAddress(entries[at]);
    setLoading(true);
  };

  const visit = (input: string) => {
    const next = webAddress(input);
    if (next) show([...history.slice(0, index + 1), next], current ? index + 1 : 0);
  };

  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <ToolbarButton label="Back" onClick={() => show(history, index - 1)} disabled={index === 0}>
          <ArrowLeft className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Forward" onClick={() => show(history, index + 1)} disabled={index >= history.length - 1}>
          <ArrowRight className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Reload"
          disabled={!current}
          onClick={() => {
            setReloads((n) => n + 1);
            setLoading(true);
          }}
        >
          {current && loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
          ) : (
            <RotateCw className="h-4 w-4" />
          )}
        </ToolbarButton>
        <form
          className="min-w-0 flex-1 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            visit(address);
          }}
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => e.target.select()}
            aria-label="Address"
            spellCheck={false}
            className="h-7 w-full rounded-full border bg-background px-3 font-mono text-[11px] outline-none transition-[border-color,box-shadow] focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          />
        </form>
      </PanelToolbar>
      {current ? (
        <iframe
          key={`${index}:${reloads}`}
          src={current}
          title={artifact.title}
          sandbox={BROWSER_SANDBOX}
          referrerPolicy="no-referrer"
          onLoad={() => setLoading(false)}
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        <p className="m-auto px-6 text-center text-sm text-muted-foreground">This address is not a web page.</p>
      )}
    </div>
  );
}
