"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/use-toast";
import { Trash2, Play, Save, PencilLine, Copy } from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/themes/prism-tomorrow.css";
import { TestFile, useTestFiles } from "@/hooks/useTestFiles";
import { useSwarmTestsConfig } from "@/hooks/useSwarmTestsConfig";

interface TestManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  generatedCode?: string;
}

export function TestManagerModal({
  isOpen,
  onClose,
  generatedCode = "",
}: TestManagerModalProps) {
  const {
    baseUrl,
    apiKey,
    loading: cfgLoading,
    error: cfgError,
  } = useSwarmTestsConfig();
  const [activeTab, setActiveTab] = useState<string>(
    generatedCode ? "generated" : "saved",
  );
  const [filename, setFilename] = useState<string>("");
  const [renameFrom, setRenameFrom] = useState<string>("");
  const [renameTo, setRenameTo] = useState<string>("");
  const [copying, setCopying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const { toast } = useToast();

  const {
    testFiles,
    isLoading,
    testResults,
    loadingTests,
    fetchTestFiles,
    runTest,
    deleteTest,
    saveTest,
    renameTest,
  } = useTestFiles(baseUrl || "", apiKey || undefined);

  useEffect(() => {
    if (isOpen && activeTab === "saved") {
      fetchTestFiles();
    }
  }, [isOpen, activeTab, fetchTestFiles]);

  useEffect(() => {
    if (isOpen && generatedCode) {
      // default filename suggestion
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      setFilename(`test-recording-${ts}.spec.js`);
    }
  }, [isOpen, generatedCode]);

  useEffect(() => {
    if (!isOpen) return;
    // small syntax highlight refresh for generated code
    setTimeout(() => {
      try {
        Prism.highlightAll();
      } catch {}
    }, 50);
  }, [isOpen, generatedCode]);

  const handleSave = async () => {
    if (!baseUrl) return;
    setSaving(true);
    console.log("Saving test", filename.trim(), generatedCode);
    console.log("Base URL", baseUrl);
    const result = await saveTest(filename.trim(), generatedCode);
    setSaving(false);
    if (result?.success) {
      toast({ title: "Saved", description: `Saved ${filename}` });
      setActiveTab("saved");
    } else {
      toast({
        title: "Save failed",
        description: String(result?.error || "Unknown error"),
        variant: "destructive",
      });
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

  const handleRename = async () => {
    if (!renameFrom || !renameTo) return;
    setRenaming(true);
    const res = await renameTest(renameFrom, renameTo);
    setRenaming(false);
    if (res?.success) {
      toast({ title: "Renamed", description: `${renameFrom} → ${renameTo}` });
      setRenameFrom("");
      setRenameTo("");
    } else {
      toast({
        title: "Rename failed",
        description: String(res?.error || "Unknown error"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="w-[98vw] h-[75vh] flex flex-col"
        style={{ width: "94vw", maxWidth: "1200px" }}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Tests</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex min-h-0 flex-col"
        >
          <TabsList>
            <TabsTrigger value="generated" disabled={!generatedCode}>
              Generated
            </TabsTrigger>
            <TabsTrigger value="saved">Saved</TabsTrigger>
          </TabsList>

          <TabsContent value="generated" className="flex-1 min-h-0 mt-2">
            {cfgLoading && (
              <div className="mb-2 text-xs text-muted-foreground">
                Resolving tests endpoint…
              </div>
            )}
            {cfgError && (
              <div className="mb-2 text-xs text-red-600">{cfgError}</div>
            )}
            <div className="flex items-center gap-2 mb-3">
              <Input
                placeholder="filename e.g. my-test.spec.js"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
              />
              <Button
                onClick={handleSave}
                disabled={
                  !filename.trim() || !generatedCode || !baseUrl || saving
                }
              >
                <Save className="w-4 h-4 mr-1" />{" "}
                {saving ? "Saving…" : "Save Test"}
              </Button>
              <Button variant="outline" onClick={handleCopy}>
                <Copy className="w-4 h-4 mr-1" /> {copying ? "Copied!" : "Copy"}
              </Button>
            </div>
            <div className="flex-1 min-h-0 border rounded">
              <ScrollArea className="h-full">
                <pre className="text-sm bg-background/50 p-4 overflow-auto">
                  <code className="language-javascript">{generatedCode}</code>
                </pre>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="saved" className="flex-1 min-h-0 mt-2">
            {cfgLoading && (
              <div className="mb-2 text-xs text-muted-foreground">
                Resolving tests endpoint…
              </div>
            )}
            {cfgError && (
              <div className="mb-2 text-xs text-red-600">{cfgError}</div>
            )}
            <div className="flex items-center gap-2 mb-3">
              <Input
                placeholder="rename: from"
                className="max-w-xs"
                value={renameFrom}
                onChange={(e) => setRenameFrom(e.target.value)}
              />
              <Input
                placeholder="to"
                className="max-w-xs"
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
              />
              <Button
                variant="secondary"
                onClick={handleRename}
                disabled={!renameFrom || !renameTo || renaming}
              >
                <PencilLine className="w-4 h-4 mr-1" />{" "}
                {renaming ? "Renaming…" : "Rename"}
              </Button>
            </div>
            <div className="flex-1 min-h-0 border rounded">
              <ScrollArea className="h-full">
                <div className="divide-y">
                  {isLoading && (
                    <div className="p-3 text-sm text-muted-foreground">
                      Loading...
                    </div>
                  )}
                  {!isLoading && testFiles.length === 0 && (
                    <div className="p-3 text-sm text-muted-foreground">
                      No tests saved yet.
                    </div>
                  )}
                  {testFiles.map((t: TestFile) => {
                    const name = t.name;
                    const result = testResults[name];
                    const isBusy = !!loadingTests[name];
                    return (
                      <div key={name} className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{name}</div>
                            <div className="text-xs text-muted-foreground">
                              {t.modified || t.created}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Run"
                              onClick={async () => {
                                const res = await runTest(name);
                                if (
                                  res &&
                                  (res as { success: boolean }).success
                                ) {
                                  toast({
                                    title: "Run completed",
                                    description: name,
                                  });
                                } else {
                                  const r = (res || {}) as {
                                    error?: unknown;
                                    errors?: unknown;
                                  };
                                  const desc =
                                    r.error ?? r.errors ?? "Unknown error";
                                  toast({
                                    title: "Run failed",
                                    description: String(desc),
                                    variant: "destructive",
                                  });
                                }
                              }}
                              disabled={isBusy}
                            >
                              <Play className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Delete"
                              onClick={async () => {
                                const ok = await deleteTest(name);
                                toast({
                                  title: ok ? "Deleted" : "Delete failed",
                                  description: name,
                                  variant: ok ? "default" : "destructive",
                                });
                              }}
                              disabled={isBusy}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        {result && (
                          <div className="mt-2 text-xs">
                            <div
                              className={`font-semibold ${result.success ? "text-green-600" : "text-red-600"}`}
                            >
                              {result.success ? "Success" : "Failed"}
                            </div>
                            {result.output && (
                              <pre className="bg-muted p-2 rounded overflow-auto mb-2">
                                <code>{result.output}</code>
                              </pre>
                            )}
                            {result.errors && result.errors.length > 0 && (
                              <pre className="bg-red-50 p-2 rounded overflow-auto text-red-700">
                                <code>{result.errors}</code>
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
