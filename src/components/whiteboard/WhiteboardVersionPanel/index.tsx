"use client";

import { useState } from "react";
import { Clock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface WhiteboardVersion {
  id: string;
  label: string;
  createdAt: string;
}

interface WhiteboardVersionPanelProps {
  whiteboardId: string;
  onReloadWhiteboard: () => void;
}

export function WhiteboardVersionPanel({
  whiteboardId,
  onReloadWhiteboard,
}: WhiteboardVersionPanelProps) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<WhiteboardVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whiteboards/${whiteboardId}/versions`);
      const data = await res.json();
      if (data.success) {
        setVersions(data.data);
      }
    } catch (error) {
      console.error("Error fetching versions:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      fetchVersions();
    }
  };

  const handleRestore = async (versionId: string) => {
    setRestoringId(versionId);
    try {
      const res = await fetch(
        `/api/whiteboards/${whiteboardId}/versions/${versionId}/restore`,
        { method: "POST" }
      );
      if (!res.ok) {
        throw new Error("Restore failed");
      }
      setOpen(false);
      onReloadWhiteboard();
      toast.success("Whiteboard restored");
    } catch (error) {
      console.error("Error restoring version:", error);
      toast.error("Failed to restore version");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Clock className="w-4 h-4" />
          Versions
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Versions
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 flex flex-col gap-3">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Loading versions…
            </p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 px-2">
              No versions saved yet. Versions are captured automatically as you edit.
            </p>
          ) : (
            versions.map((version) => (
              <div
                key={version.id}
                className="flex items-center justify-between rounded-lg border p-3 gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{version.label}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={restoringId === version.id}
                  onClick={() => handleRestore(version.id)}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {restoringId === version.id ? "Restoring…" : "Restore"}
                </Button>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
