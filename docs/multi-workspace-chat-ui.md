# Multi-Workspace Chat UI Plan

Frontend changes for the multi-workspace chat feature (Phase 2 of `docs/multi-workspace-chat.md`).

Core files:

- `src/components/dashboard/DashboardChat/index.tsx`
- `src/components/dashboard/DashboardChat/ChatInput.tsx`
- `src/components/dashboard/DashboardChat/WorkspacePills.tsx` (new)

---

## Current State

`DashboardChat` gets `slug` from `useWorkspace()` and sends it to `/api/ask/quick` as `workspaceSlug`. The backend already supports an optional `workspaceSlugs: string[]` parameter for multi-workspace mode (see `multi-workspace-chat.md`). No frontend changes have been made yet.

---

## Design

### Visual Layout

```
 ┌──────────────────────────────────────────────────────┐
 │  (chat messages area)                                │
 │                                                      │
 ├──────────────────────────────────────────────────────┤
 │                                                      │
 │   ┌──────────────┐ ┌──────────────┐                  │
 │   │ sphinx-tribes ✕│ │ stakwork    ✕│  ← pills row   │
 │   └──────────────┘ └──────────────┘                  │
 │                                                      │
 │  [img] [Ask me about your codebase...        ] [▶]  │
 │    ↑                                                 │
 │    + button (left of image button)                   │
 │                                                      │
 └──────────────────────────────────────────────────────┘
```

When no extra workspaces are added, the pills row is hidden and nothing changes from the current UI.

### Add Workspace Button

- Small round `+` button, same size as the existing image upload button (`h-10 w-10 rounded-full`).
- Positioned to the left of the image upload button in the `ChatInput` form row.
- Tooltip: "Add workspace" (using existing `Tooltip` / `TooltipTrigger` / `TooltipContent` from `@/components/ui/tooltip`).
- On click: opens a `Popover` with a list of the user's other workspaces (excluding the current one and any already added).
- Uses `Plus` icon from `lucide-react`.

### Workspace Picker Popover

- Uses shadcn `Popover` + `Command` (cmdk) for a searchable list, same pattern as `AssigneeCombobox`.
- Lists workspaces from `useWorkspace().workspaces`, filtered to exclude:
  - The current workspace (already implicit context).
  - Any workspace already in the `extraWorkspaces` array.
- Each item shows workspace name. Click adds it and closes the popover.
- Cap enforced: if `extraWorkspaces.length >= 4` (current + 4 = 5 total), show a disabled message "Maximum 5 workspaces" instead of the list.

### Workspace Pills

- Rendered in a new `WorkspacePills` component above the textarea inside `ChatInput`.
- Each pill is a small `Badge` variant="secondary" with the workspace name and an `X` close button.
- Clicking `X` removes that workspace from `extraWorkspaces`.
- Layout: horizontal flex row with `gap-1.5`, wrapping if needed. Horizontally left-aligned above the textarea.
- Only renders when `extraWorkspaces.length > 0`.

---

## Implementation

### 1. State: `extraWorkspaces` in `DashboardChat`

**File:** `src/components/dashboard/DashboardChat/index.tsx`

Add state to track additional workspaces selected for the chat session:

```typescript
const [extraWorkspaceSlugs, setExtraWorkspaceSlugs] = useState<string[]>([]);
```

When clearing the conversation (`handleClearAll`), also clear `extraWorkspaceSlugs`.

### 2. Update the API Call

In `handleSend`, change the request body from `workspaceSlug` to `workspaceSlugs` when extras are present:

```typescript
body: JSON.stringify({
  messages: /* ... existing logic ... */,
  // Single workspace mode (backward compatible)
  ...(extraWorkspaceSlugs.length === 0
    ? { workspaceSlug: slug }
    : { workspaceSlugs: [slug, ...extraWorkspaceSlugs] }),
}),
```

Same change in `handleCreateFeature` (the feature-creation call should still use the current workspace only, no change needed there).

### 3. Pass Props Through `ChatInput`

**File:** `src/components/dashboard/DashboardChat/ChatInput.tsx`

Add new props to `ChatInputProps`:

```typescript
interface ChatInputProps {
  // ... existing props ...
  extraWorkspaceSlugs?: string[];
  onAddWorkspace?: (slug: string) => void;
  onRemoveWorkspace?: (slug: string) => void;
  currentWorkspaceSlug?: string;
}
```

### 4. Add Workspace Button in `ChatInput`

In `ChatInput`, add a `+` button to the left of the image upload button. Wrapped in `Tooltip` for hover text.

```tsx
import { Plus } from "lucide-react";
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
```

The button + popover, placed before the image upload `<div className="relative">`:

```tsx
{/* Add workspace button */}
<Popover open={isWorkspacePickerOpen} onOpenChange={setIsWorkspacePickerOpen}>
  <Tooltip>
    <TooltipTrigger asChild>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="h-10 w-10 rounded-full border-2 border-border/20
            hover:border-primary/50 bg-background/5 transition-all
            flex items-center justify-center
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4 text-muted-foreground" />
        </button>
      </PopoverTrigger>
    </TooltipTrigger>
    <TooltipContent>Add workspace</TooltipContent>
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
```

Where `availableWorkspaces` is computed inside `ChatInput`:

```typescript
const { workspaces } = useWorkspace();
const [isWorkspacePickerOpen, setIsWorkspacePickerOpen] = useState(false);

const availableWorkspaces = workspaces.filter(
  (ws) =>
    ws.slug !== currentWorkspaceSlug &&
    !extraWorkspaceSlugs?.includes(ws.slug)
);
```

If `extraWorkspaceSlugs.length >= 4`, disable the button and change tooltip to "Maximum 5 workspaces".

### 5. Workspace Pills Component

**File:** `src/components/dashboard/DashboardChat/WorkspacePills.tsx` (new)

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";

interface WorkspacePillsProps {
  slugs: string[];
  onRemove: (slug: string) => void;
}

export function WorkspacePills({ slugs, onRemove }: WorkspacePillsProps) {
  const { workspaces } = useWorkspace();

  if (slugs.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-1">
      {slugs.map((slug) => {
        const ws = workspaces.find((w) => w.slug === slug);
        const label = ws?.name ?? slug;
        return (
          <Badge
            key={slug}
            variant="secondary"
            className="gap-1 pr-1 text-xs font-normal"
          >
            {label}
            <button
              type="button"
              onClick={() => onRemove(slug)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20
                transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        );
      })}
    </div>
  );
}
```

### 6. Render Pills in `ChatInput`

Inside the `ChatInput` `<form>`, render `WorkspacePills` above the textarea row. The pills sit between the form's top edge and the input controls:

```tsx
<form onSubmit={handleSubmit} /* ... existing props ... */>
  {/* Drag overlay (unchanged) */}

  {/* Workspace pills row */}
  <WorkspacePills
    slugs={extraWorkspaceSlugs || []}
    onRemove={(slug) => onRemoveWorkspace?.(slug)}
  />

  {/* Existing input row: [+] [img] [textarea [send]] [feature] [eye] [share] */}
  <div className="flex items-center gap-2">
    {/* + button, image button, textarea, action buttons ... */}
  </div>
</form>
```

This requires a small layout restructure of `ChatInput`: wrap the existing flex row of controls in an inner `<div>`, and let the `<form>` itself be a vertical flex column. The pills row goes above, the controls row goes below.

Current form layout:
```
<form className="relative flex justify-center items-center gap-2 ...">
  [drag overlay]
  [image btn] [textarea] [feature btn] [eye btn] [share btn]
</form>
```

New form layout:
```
<form className="relative flex flex-col items-center gap-1 ...">
  [drag overlay]
  [pills row]                              ← conditional
  <div className="flex items-center gap-2 w-full justify-center">
    [+ btn] [image btn] [textarea] [feature btn] [eye btn] [share btn]
  </div>
</form>
```

### 7. Wire It Up in `DashboardChat`

Pass the new props from `DashboardChat` to `ChatInput`:

```tsx
<ChatInput
  onSend={handleSend}
  disabled={isLoading}
  // ... existing props ...
  extraWorkspaceSlugs={extraWorkspaceSlugs}
  onAddWorkspace={(ws) =>
    setExtraWorkspaceSlugs((prev) => [...prev, ws])
  }
  onRemoveWorkspace={(ws) =>
    setExtraWorkspaceSlugs((prev) => prev.filter((s) => s !== ws))
  }
  currentWorkspaceSlug={slug}
/>
```

---

## Edge Cases

1. **User has only one workspace** - The `+` button still appears but the popover shows `CommandEmpty` ("No workspaces found"). This is fine since it's a small unobtrusive button.

2. **Clearing conversation** - `handleClearAll` resets `extraWorkspaceSlugs` to `[]`, removing all pills.

3. **Removing last extra workspace mid-conversation** - The next message reverts to single-workspace mode (`workspaceSlug`). Previous multi-workspace messages in the conversation history are still valid since they contain plain text/tool-call content.

4. **5-workspace cap** - Enforced both frontend (disable `+` button at 4 extras) and backend (returns 400 if `slugs.length > 5`).

---

## What Doesn't Change

- `ToolCallIndicator` already renders `toolName` generically, so namespaced names like `hive:list_concepts` display naturally.
- `ChatMessage` renders markdown text, unaffected.
- `ProvenanceTree` works off the primary workspace, no change needed.
- Follow-up questions come via Pusher on the primary workspace channel, no change needed.
- Feature creation always uses the current workspace slug, no change needed.
- Share functionality serializes messages as-is, no change needed.

---

## Files Changed

| File | Change |
|---|---|
| `DashboardChat/index.tsx` | Add `extraWorkspaceSlugs` state, update `handleSend` body, pass new props to `ChatInput`, clear extras on `handleClearAll` |
| `DashboardChat/ChatInput.tsx` | Add `+` button with Popover/Command picker, restructure form layout for pills row, accept new props |
| `DashboardChat/WorkspacePills.tsx` | New file: renders removable Badge pills for extra workspaces |
