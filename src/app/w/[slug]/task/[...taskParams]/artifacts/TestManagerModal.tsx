"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/use-toast";
import { Copy, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/themes/prism-tomorrow.css";

interface TestManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  generatedCode?: string;
  onUserJourneySave?: (filename: string, generatedCode: string) => void;
  initialTab?: string;
}

export function TestManagerModal({
  isOpen,
  onClose,
  generatedCode = "",
  onUserJourneySave,
  initialTab = "",
}: TestManagerModalProps) {
  const [copying, setCopying] = useState(false);
  const [filename, setFilename] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && generatedCode) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      setFilename(`test-recording-${ts}.spec.js`);
    }
  }, [isOpen, generatedCode]);

  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => {
      try {
        Prism.highlightAll();
      } catch {}
    }, 50);
  }, [isOpen, generatedCode]);

  const handleSave = async () => {
    if (onUserJourneySave) {
      onUserJourneySave(filename.trim(), generatedCode);
      onClose();
      return;
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopying(true);
      setTimeout(() => setCopying(false), 1200);
      toast({ title: "Copied", description: "Test code copied to clipboard" });
    } catch {}
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[98vw] h-[75vh] flex flex-col" style={{ width: "94vw", maxWidth: "1200px" }}>
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Generated Test</DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            {onUserJourneySave && (
              <>
                <Input
                  placeholder="filename e.g. my-test.spec.js"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                />
                <Button onClick={handleSave} disabled={!filename.trim() || !generatedCode || saving}>
                  <Save className="w-4 h-4 mr-1" /> {saving ? "Saving…" : "Save Test"}
                </Button>
              </>
            )}
            <Button variant="outline" onClick={handleCopy} className={onUserJourneySave ? "" : "ml-auto"}>
              <Copy className="w-4 h-4 mr-1" /> {copying ? "Copied!" : "Copy"}
            </Button>
          </div>
          <div className="flex-1 min-h-0 border rounded overflow-hidden">
            <ScrollArea className="h-full">
              <pre className="text-sm bg-background/50 p-4 overflow-auto whitespace-pre max-h-[60vh]">
                <code className="language-javascript">{generatedCode}</code>
              </pre>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
