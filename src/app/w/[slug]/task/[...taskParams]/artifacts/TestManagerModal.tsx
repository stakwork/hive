"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TestManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  generatedCode?: string;
  errorMessage?: string;
  onUserJourneySave?: (testName: string, generatedCode: string) => void;
}

export function TestManagerModal({
  isOpen,
  onClose,
  generatedCode = "",
  errorMessage = "",
  onUserJourneySave,
}: TestManagerModalProps) {
  const [testName, setTestName] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && generatedCode) {
      setTestName("");
    }
  }, [isOpen, generatedCode]);

  const handleSave = async () => {
    if (!testName.trim()) {
      toast({
        title: "Test name required",
        description: "Please enter a name for your test",
        variant: "destructive",
      });
      return;
    }
    if (onUserJourneySave) {
      setSaving(true);
      onUserJourneySave(testName, generatedCode);
      setSaving(false);
      onClose();
      return;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-2xl">Save User Journey</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-base font-medium">
              Name
            </Label>
            <Input
              id="name"
              placeholder="e.g., User Login Flow"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              className="text-base h-12"
              autoFocus
            />
          </div>
          {errorMessage && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">{errorMessage}</div>
          )}
        </div>

        <div className="flex gap-3">
          {onUserJourneySave && (
            <Button
              onClick={handleSave}
              disabled={!testName.trim() || !generatedCode || saving}
              size="lg"
              className="flex-1 h-12 text-base"
            >
              {saving ? (
                <>Saving...</>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 mr-2" />
                  Save Test
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
