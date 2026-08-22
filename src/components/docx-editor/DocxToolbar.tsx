"use client";
import React from "react";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FolderOpen,
  Download,
  Archive,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  CheckCheck,
  XCircle,
  Eye,
  PanelLeft,
  PanelRight,
  Search,
  GitCompare,
  FileText,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditorState } from "@/lib/docx-editor/editor-state";
import { EditorAction } from "@/lib/docx-editor/use-docx-editor";

export type RightPanelKind = "changes" | "comments" | "versions" | null;

interface DocxToolbarProps {
  activeState: EditorState | null;
  allStates: EditorState[];
  dispatch: (index: number, action: EditorAction) => void;
  activeIndex: number;
  showLeftPanel: boolean;
  onToggleLeftPanel: () => void;
  rightPanel: RightPanelKind;
  onRightPanel: (kind: RightPanelKind) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  showTrackChanges: boolean;
  onToggleTrackChanges: () => void;
  onOpenFile: () => void;
  onDownload: () => void;
  onDownloadAll: () => void;
  onFindReplace: () => void;
  onCompare: () => void;
  onBlackline: () => void;
  /** Current user's bold/italic/underline/strikethrough state for the selection */
  formatState?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
  };
}

function TBtn({
  onClick,
  tip,
  disabled = false,
  children,
  variant = "ghost",
}: {
  onClick: () => void;
  tip: string;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: "ghost" | "outline" | "default";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant={variant}
          onClick={onClick}
          disabled={disabled}
          className="h-7 w-7"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export default function DocxToolbar({
  activeState,
  allStates,
  dispatch,
  activeIndex,
  showLeftPanel,
  onToggleLeftPanel,
  rightPanel,
  onRightPanel,
  zoom,
  onZoomChange,
  showTrackChanges,
  onToggleTrackChanges,
  onOpenFile,
  onDownload,
  onDownloadAll,
  onFindReplace,
  onCompare,
  onBlackline,
  formatState = {},
}: DocxToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasDoc = activeState !== null;
  const canUndo = hasDoc && activeState!.history.length > 0;
  const canRedo = hasDoc && activeState!.future.length > 0;

  const d = (action: EditorAction) => dispatch(activeIndex, action);

  const setCharProp = (prop: "bold" | "italic" | "underline" | "strikethrough", value: boolean) =>
    d({ type: "SET_CHARACTER_PROPERTY", prop, value });

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-background flex-none flex-wrap min-h-[40px]">
        {/* ── File ─────────────────────────────────────── */}
        <TBtn onClick={onOpenFile} tip="Open file(s)">
          <FolderOpen className="size-3.5" />
        </TBtn>
        <TBtn onClick={onDownload} tip="Download active document (.docx)" disabled={!hasDoc}>
          <Download className="size-3.5" />
        </TBtn>
        <TBtn onClick={onDownloadAll} tip="Download all documents (.zip)" disabled={allStates.length === 0}>
          <Archive className="size-3.5" />
        </TBtn>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* ── Edit ─────────────────────────────────────── */}
        <TBtn onClick={() => d({ type: "UNDO" })} tip="Undo (Ctrl+Z)" disabled={!canUndo}>
          <Undo2 className="size-3.5" />
        </TBtn>
        <TBtn onClick={() => d({ type: "REDO" })} tip="Redo (Ctrl+Shift+Z)" disabled={!canRedo}>
          <Redo2 className="size-3.5" />
        </TBtn>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* ── Format ───────────────────────────────────── */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={formatState.bold}
              onPressedChange={(v) => setCharProp("bold", v)}
              disabled={!hasDoc}
              className="h-7 w-7 data-[state=on]:bg-accent"
            >
              <Bold className="size-3.5" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Bold (Ctrl+B)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={formatState.italic}
              onPressedChange={(v) => setCharProp("italic", v)}
              disabled={!hasDoc}
              className="h-7 w-7 data-[state=on]:bg-accent"
            >
              <Italic className="size-3.5" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Italic (Ctrl+I)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={formatState.underline}
              onPressedChange={(v) => setCharProp("underline", v)}
              disabled={!hasDoc}
              className="h-7 w-7 data-[state=on]:bg-accent"
            >
              <Underline className="size-3.5" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Underline (Ctrl+U)</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={formatState.strikethrough}
              onPressedChange={(v) => setCharProp("strikethrough", v)}
              disabled={!hasDoc}
              className="h-7 w-7 data-[state=on]:bg-accent"
            >
              <Strikethrough className="size-3.5" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Strikethrough</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* ── Track Changes ─────────────────────────────── */}
        <TBtn
          onClick={() => dispatch(activeIndex, { type: "ACCEPT_ALL_CHANGES" })}
          tip="Accept all changes (active doc)"
          disabled={!hasDoc}
        >
          <CheckCheck className="size-3.5 text-green-600" />
        </TBtn>
        <TBtn
          onClick={() => dispatch(activeIndex, { type: "REJECT_ALL_CHANGES" })}
          tip="Reject all changes (active doc)"
          disabled={!hasDoc}
        >
          <XCircle className="size-3.5 text-red-600" />
        </TBtn>
        {allStates.length > 1 && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs gap-0.5" disabled={!hasDoc}>
                    All docs <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Accept/reject across all documents</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => allStates.forEach((_, i) => dispatch(i, { type: "ACCEPT_ALL_CHANGES" }))}
                className="text-green-600 text-sm"
              >
                <CheckCheck className="size-3.5 mr-2" /> Accept All Docs
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => allStates.forEach((_, i) => dispatch(i, { type: "REJECT_ALL_CHANGES" }))}
                className="text-red-600 text-sm"
              >
                <XCircle className="size-3.5 mr-2" /> Reject All Docs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={showTrackChanges}
              onPressedChange={onToggleTrackChanges}
              className="h-7 px-2 text-xs data-[state=on]:bg-accent gap-1"
            >
              <Eye className="size-3.5" />
              Changes
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Show / hide tracked changes</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* ── View ─────────────────────────────────────── */}
        <Select
          value={String(zoom)}
          onValueChange={(v) => onZoomChange(Number(v))}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <SelectTrigger className="h-7 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
            </TooltipTrigger>
            <TooltipContent>Zoom level</TooltipContent>
          </Tooltip>
          <SelectContent>
            <SelectItem value="75">75%</SelectItem>
            <SelectItem value="100">100%</SelectItem>
            <SelectItem value="125">125%</SelectItem>
          </SelectContent>
        </Select>

        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={showLeftPanel}
              onPressedChange={onToggleLeftPanel}
              className="h-7 w-7 data-[state=on]:bg-accent"
            >
              <PanelLeft className="size-3.5" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Toggle clause navigator</TooltipContent>
        </Tooltip>

        {/* Right panel selector */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-1.5 gap-0.5 data-[state=open]:bg-accent"
                >
                  <PanelRight className="size-3.5" />
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Right panel</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onRightPanel(rightPanel === "changes" ? null : "changes")}>
              {rightPanel === "changes" ? "✓ " : ""} Changes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRightPanel(rightPanel === "comments" ? null : "comments")}>
              {rightPanel === "comments" ? "✓ " : ""} Comments
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRightPanel(rightPanel === "versions" ? null : "versions")}>
              {rightPanel === "versions" ? "✓ " : ""} Versions
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* ── Tools ────────────────────────────────────── */}
        <TBtn onClick={onFindReplace} tip="Find & Replace (Ctrl+H)">
          <Search className="size-3.5" />
        </TBtn>
        <TBtn onClick={onCompare} tip="Compare documents" disabled={allStates.length < 2}>
          <GitCompare className="size-3.5" />
        </TBtn>
        <TBtn onClick={onBlackline} tip="Generate blackline" disabled={allStates.length < 1}>
          <FileText className="size-3.5" />
        </TBtn>
      </div>
    </TooltipProvider>
  );
}
