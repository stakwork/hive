"use client";

import React, { useState, useEffect } from "react";
import { ExternalLink, FileIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HarveyTask } from "@/lib/harvey-lab-tasks";
import { WORK_TYPE_STYLES } from "@/lib/harvey-lab-tasks";
import { formatMB } from "@/lib/utils/format";
import {
  getModelValue,
  DEFAULT_STANDARD_MODEL,
  DEFAULT_REASONING_MODEL,
  PROVIDER_API_KEY_ENV_VARS,
  PROVIDER_DISPLAY_LABELS,
  type LlmModelOption,
} from "@/lib/ai/models";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskDetails {
  title: string | null;
  instructions: string | null;
  criteria: Array<{ id: string; title: string; match_criteria: string }> | null;
  documents: Array<{ name: string; url: string; download_url: string }>;
}

interface FileSizeData {
  total_source_size_bytes: number;
  files: { name: string; size: number }[];
}

export interface TaskDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: HarveyTask;
  slug: string;
  onRunTask: (options: {
    generateJamieChat: boolean;
    generateRunReport: boolean;
    /** Provider-prefixed, e.g. "anthropic/claude-sonnet-5". Omitted when the catalog is unavailable. */
    standardModel?: string;
    reasoningModel?: string;
  }) => void;
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DetailsSkeleton() {
  return (
    <div className="space-y-6 p-1">
      <section>
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-3 w-full mb-2" />
        <Skeleton className="h-3 w-5/6 mb-2" />
        <Skeleton className="h-3 w-4/5" />
      </section>

      <Separator className="my-4" />

      <section>
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-3 w-2/3 mb-2" />
        <Skeleton className="h-3 w-1/2" />
      </section>

      <Separator className="my-4" />

      <section>
        <Skeleton className="h-4 w-28 mb-3" />
        <Skeleton className="h-3 w-full mb-2" />
        <Skeleton className="h-3 w-5/6 mb-2" />
        <Skeleton className="h-3 w-3/4" />
      </section>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskDetailsModal({
  open,
  onOpenChange,
  task,
  slug,
  onRunTask,
}: TaskDetailsModalProps) {
  const [details, setDetails] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sizeData, setSizeData] = useState<FileSizeData | null>(null);
  const [sizeLoading, setSizeLoading] = useState(true);
  // The Jamie chat (org-canvas conversation), NOT the run report bundle.
  const [generateJamieChat, setGenerateJamieChat] = useState(false);
  // The run report bundle, NOT the Jamie chat.
  const [generateRunReport, setGenerateRunReport] = useState(false);

  // ─── Model selection (standard_model / reasoning_model pair) ───────────────
  // Both models are constrained to one provider so the run route can resolve a
  // single provider-correct apiKey from the hive env.
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [standardModel, setStandardModel] = useState<string>("");
  const [reasoningModel, setReasoningModel] = useState<string>("");

  useEffect(() => {
    if (!open || llmModels.length > 0) return;
    let cancelled = false;
    fetch("/api/llm-models")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.models) return;
        // Only providers with a known API key env var can be dispatched
        const usable = (data.models as LlmModelOption[]).filter(
          (m) => !!PROVIDER_API_KEY_ENV_VARS[m.provider],
        );
        setLlmModels(usable);
        if (usable.length === 0) return;
        const provider = usable.some((m) => m.provider === "ANTHROPIC")
          ? "ANTHROPIC"
          : usable[0].provider;
        setSelectedProvider(provider);
        applyProviderDefaults(usable, provider);
      })
      .catch(() => {
        /* selectors stay hidden; the run route falls back to defaults */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const applyProviderDefaults = (models: LlmModelOption[], provider: string) => {
    const values = models.filter((m) => m.provider === provider).map(getModelValue);
    if (values.length === 0) return;
    setStandardModel(values.includes(DEFAULT_STANDARD_MODEL) ? DEFAULT_STANDARD_MODEL : values[0]);
    setReasoningModel(values.includes(DEFAULT_REASONING_MODEL) ? DEFAULT_REASONING_MODEL : values[0]);
  };

  const providers = Array.from(new Set(llmModels.map((m) => m.provider)));
  const providerModels = llmModels.filter((m) => m.provider === selectedProvider);

  useEffect(() => {
    if (!open || !task?.slug) {
      setDetails(null);
      setError(null);
      setSizeData(null);
      setSizeLoading(false);
      return;
    }

    let cancelled = false;

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/workspaces/${slug}/legal/benchmarks/tasks/details/${task.slug}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? `Request failed with status ${res.status}`);
        }
        const data: TaskDetails = await res.json();
        if (!cancelled) setDetails(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load task details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [open, task?.slug, slug]);

  useEffect(() => {
    if (!open || !task?.slug || !slug) return;
    let cancelled = false;
    setSizeLoading(true);
    setSizeData(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${slug}/legal/benchmarks/tasks/size/${task.slug}`,
        );
        if (!res.ok) return;
        const data: FileSizeData = await res.json();
        if (!cancelled && data.files.length > 0) setSizeData(data);
      } catch {
        // silent fail — no toast, no message
      } finally {
        if (!cancelled) setSizeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, task?.slug, slug]);

  const visibleTags = task.tags.slice(0, 3);
  const overflowCount = task.tags.length - 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[80vh] flex flex-col overflow-hidden p-0" style={{ backgroundColor: 'var(--background)' }}>
        <DialogHeader className="px-6 pt-6 pb-0 pr-10 shrink-0">
          <DialogTitle>{task.title}</DialogTitle>
          <div className="flex flex-wrap gap-2 mt-1">
            <Badge
              variant="outline"
              className={`text-xs capitalize border-0 ${WORK_TYPE_STYLES[task.work_type]}`}
            >
              {task.work_type}
            </Badge>

            {visibleTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs text-muted-foreground">
                {tag}
              </Badge>
            ))}

            {overflowCount > 0 && (
              <Badge variant="secondary" className="text-xs text-muted-foreground">
                +{overflowCount} more
              </Badge>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 px-6 py-4">
          <div className="p-1">
            {loading ? (
              <DetailsSkeleton />
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDetails(null);
                    setError(null);
                    setLoading(true);
                    fetch(
                      `/api/workspaces/${slug}/legal/benchmarks/tasks/details/${task.slug}`,
                    )
                      .then(async (res) => {
                        if (!res.ok) {
                          const body = await res.json().catch(() => ({}));
                          throw new Error(
                            body?.error ?? `Request failed with status ${res.status}`,
                          );
                        }
                        return res.json();
                      })
                      .then((data) => {
                        setDetails(data);
                        setLoading(false);
                      })
                      .catch((err) => {
                        setError(
                          err instanceof Error ? err.message : "Failed to load task details",
                        );
                        setLoading(false);
                      });
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : details ? (
              <div className="space-y-0">
                {/* Section 1: Task Instructions */}
                <section>
                  <h3 className="text-sm font-semibold mb-2">Task</h3>
                  {details.instructions ? (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {details.instructions}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No instructions available.</p>
                  )}
                  {/* Two independent artifacts, two independent opt-ins.
                      Jamie Chat  → org-canvas conversation written after the run.
                      Generate Report → `generate_report` set_var to the Harvey
                                        runner, which returns a report_url. */}
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="jamie-chat"
                        checked={generateJamieChat}
                        onCheckedChange={(checked) => setGenerateJamieChat(checked === true)}
                        data-testid="jamie-chat-checkbox"
                      />
                      <label
                        htmlFor="jamie-chat"
                        className="text-sm font-medium cursor-pointer select-none"
                      >
                        Jamie Chat
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="generate-run-report"
                        checked={generateRunReport}
                        onCheckedChange={(checked) => setGenerateRunReport(checked === true)}
                        data-testid="generate-run-report-checkbox"
                      />
                      <label
                        htmlFor="generate-run-report"
                        className="text-sm font-medium cursor-pointer select-none"
                      >
                        Generate Report
                      </label>
                    </div>
                  </div>
                </section>

                <Separator className="my-4" />

                {/* Section 2: Documents */}
                <section>
                  <h3 className="text-sm font-semibold mb-2">
                    Documents ({details.documents.length})
                  </h3>
                  {details.documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No documents attached.</p>
                  ) : (
                    <>
                      <ul className="space-y-1">
                        {details.documents.map((doc) => {
                          const matchedFile = sizeData?.files.find((f) => f.name === doc.name);
                          return (
                            <li key={doc.name} className="flex items-center gap-2 text-sm">
                              <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                              <a
                                href={doc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline truncate min-w-0"
                              >
                                {doc.name}
                              </a>
                              {doc.name.toLowerCase().endsWith(".docx") && (
                                <a
                                  href={`/w/${slug}/documents?url=${encodeURIComponent(doc.download_url)}&filename=${encodeURIComponent(doc.name)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="Open in Document Editor"
                                  className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors shrink-0"
                                  data-testid="open-in-editor-link"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                              {matchedFile && (
                                <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                                  {formatMB(matchedFile.size)}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {sizeLoading && !sizeData && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground mt-2" />
                      )}
                      {sizeData && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Total: {formatMB(sizeData.total_source_size_bytes)}
                        </p>
                      )}
                    </>
                  )}
                </section>

                <Separator className="my-4" />

                {/* Section 3: Rubric Criteria */}
                <section>
                  <h3 className="text-sm font-semibold mb-2">
                    Rubric ({details.criteria?.length ?? 0} criteria)
                  </h3>
                  {!details.criteria || details.criteria.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No rubric criteria available.</p>
                  ) : (
                    <ol className="space-y-3">
                      {details.criteria.map((c) => (
                        <li key={c.id} className="text-sm">
                          <span className="font-medium text-muted-foreground mr-2">{c.id}</span>
                          <span>{c.title}</span>
                          <p className="text-xs text-muted-foreground mt-1 pl-8">
                            {c.match_criteria}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </ScrollArea>

        {/* Model selection — provider-constrained standard/reasoning pair */}
        {llmModels.length > 0 && (
          <div className="border-t px-6 py-3 shrink-0 flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-xs text-muted-foreground">Provider</span>
              <Select
                value={selectedProvider}
                onValueChange={(provider) => {
                  setSelectedProvider(provider);
                  applyProviderDefaults(llmModels, provider);
                }}
              >
                <SelectTrigger
                  className="h-7 text-xs px-2 w-auto min-w-[120px]"
                  data-testid="provider-select"
                >
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p} value={p} className="text-xs">
                      {PROVIDER_DISPLAY_LABELS[p] ?? p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-xs text-muted-foreground">Standard Model</span>
              <Select value={standardModel} onValueChange={setStandardModel}>
                <SelectTrigger
                  className="h-7 text-xs px-2 w-auto min-w-[160px] max-w-[220px]"
                  data-testid="standard-model-select"
                >
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {providerModels.map((m) => (
                    <SelectItem key={m.id} value={getModelValue(m)} className="text-xs">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-xs text-muted-foreground">Reasoning Model</span>
              <Select value={reasoningModel} onValueChange={setReasoningModel}>
                <SelectTrigger
                  className="h-7 text-xs px-2 w-auto min-w-[160px] max-w-[220px]"
                  data-testid="reasoning-model-select"
                >
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {providerModels.map((m) => (
                    <SelectItem key={m.id} value={getModelValue(m)} className="text-xs">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="border-t px-6 py-4 gap-2 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onRunTask({
                generateJamieChat,
                generateRunReport,
                ...(standardModel ? { standardModel } : {}),
                ...(reasoningModel ? { reasoningModel } : {}),
              });
            }}
          >
            Run Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
