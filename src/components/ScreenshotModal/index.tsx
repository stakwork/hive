"use client";

import { useEffect } from "react";
import { Screenshot } from "@/types/common";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";

interface ScreenshotModalProps {
  screenshot: Screenshot | null;
  allScreenshots: Screenshot[];
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (screenshot: Screenshot) => void;
}

export function ScreenshotModal({
  screenshot,
  allScreenshots,
  isOpen,
  onClose,
  onNavigate,
}: ScreenshotModalProps) {
  if (!screenshot) return null;

  const currentIndex = allScreenshots.findIndex((s) => s.id === screenshot.id);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < allScreenshots.length - 1;

  const handlePrevious = () => {
    if (hasPrevious) {
      onNavigate(allScreenshots[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (hasNext) {
      onNavigate(allScreenshots[currentIndex + 1]);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && hasPrevious) {
        event.preventDefault();
        onNavigate(allScreenshots[currentIndex - 1]);
      } else if (event.key === "ArrowRight" && hasNext) {
        event.preventDefault();
        onNavigate(allScreenshots[currentIndex + 1]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, hasPrevious, hasNext, currentIndex, allScreenshots, onNavigate]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-col gap-1">
            <span>Screenshot - Action {screenshot.actionIndex + 1}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {screenshot.url}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="relative w-full">
          <div className="relative w-full bg-muted rounded-lg overflow-hidden">
            <Image
              src={screenshot.dataUrl}
              alt={`Screenshot of ${screenshot.url}`}
              width={1200}
              height={800}
              className="w-full h-auto"
              unoptimized
            />
          </div>

          {/* Navigation buttons */}
          {allScreenshots.length > 1 && (
            <div className="flex items-center justify-between mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrevious}
                onClick={handlePrevious}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                {currentIndex + 1} of {allScreenshots.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={handleNext}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground mt-2">
          Captured: {new Date(screenshot.timestamp).toLocaleString()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
