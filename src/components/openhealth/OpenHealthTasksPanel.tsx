"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  OPENHEALTH_DEFAULT_SPLIT,
  OPENHEALTH_SPLITS,
  OPENHEALTH_TASK_NAMES,
  type OpenHealthSplit,
  type OpenHealthTaskName,
} from "@/lib/openhealth-benchmarks/constants";

interface InstanceRow {
  gt_id: string;
  task: string;
  granularity: string | null;
  split: string;
  patient_id: string | null;
  encounter_id: string | null;
  difficulty: string | null;
  variant?: string | null;
  clinical_question?: string | null;
  specialty?: string | null;
}

const TASK_LABELS: Record<OpenHealthTaskName, string> = {
  patient_diagnosis: "Patient Diagnosis",
  context_summarization: "Context Summarization",
  evidence_retrieval: "Evidence Retrieval",
  imaging_indication: "Imaging Indication",
};

const SPLIT_LABELS: Record<OpenHealthSplit, string> = {
  public: "Public (200)",
  heldout: "Heldout",
};

function cell(value: unknown): string {
  return value === null || value === undefined || value === "" ? "" : String(value);
}

export function OpenHealthTasksPanel() {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;

  const [split, setSplit] = useState<OpenHealthSplit>(OPENHEALTH_DEFAULT_SPLIT);
  const [taskFilter, setTaskFilter] = useState<OpenHealthTaskName | "all">("all");
  const [rows, setRows] = useState<InstanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingKey, setStartingKey] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    if (!slug) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ split });
      if (taskFilter !== "all") params.set("task", taskFilter);
      const res = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/tasks?${params}`);
      if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`);
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [slug, split, taskFilter]);

  // Default split is public; train is never requested here — there is no
  // control for it, and this effect only ever sends "public" or "heldout".
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const startRun = useCallback(
    async (row: InstanceRow) => {
      if (!slug) return;
      const key = `${row.task}:${row.gt_id}`;
      setStartingKey(key);
      try {
        const res = await fetch(`/api/workspaces/${slug}/openhealth/benchmarks/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: row.task,
            split: row.split,
            gtId: row.gt_id,
            patientId: row.patient_id,
          }),
        });
        if (res.status === 409) {
          toast.error("A run is already in progress for this task");
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Failed to start run (${res.status})`);
        }
        toast.success("Run started");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start run");
      } finally {
        setStartingKey(null);
      }
    },
    [slug],
  );

  const showContextColumns = taskFilter === "context_summarization";

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={split} onValueChange={(v) => setSplit(v as OpenHealthSplit)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPENHEALTH_SPLITS.map((s) => (
              <SelectItem key={s} value={s}>
                {SPLIT_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={taskFilter}
          onValueChange={(v) => setTaskFilter(v as OpenHealthTaskName | "all")}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All task types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All task types</SelectItem>
            {OPENHEALTH_TASK_NAMES.map((t) => (
              <SelectItem key={t} value={t}>
                {TASK_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="flex-1 min-h-0 overflow-auto border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>GT ID</TableHead>
              <TableHead>Granularity</TableHead>
              <TableHead>Patient ID</TableHead>
              <TableHead>Encounter ID</TableHead>
              <TableHead>Difficulty</TableHead>
              {showContextColumns && (
                <>
                  <TableHead>Variant</TableHead>
                  <TableHead>Clinical Question</TableHead>
                  <TableHead>Specialty</TableHead>
                </>
              )}
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={showContextColumns ? 10 : 7} className="text-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin inline-block" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showContextColumns ? 10 : 7} className="text-center py-8 text-muted-foreground">
                  No tasks found
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const key = `${row.task}:${row.gt_id}`;
                return (
                  <TableRow key={key}>
                    <TableCell>{cell(row.task)}</TableCell>
                    <TableCell className="font-mono text-xs">{cell(row.gt_id)}</TableCell>
                    <TableCell>{cell(row.granularity)}</TableCell>
                    <TableCell className="font-mono text-xs">{cell(row.patient_id)}</TableCell>
                    <TableCell className="font-mono text-xs">{cell(row.encounter_id)}</TableCell>
                    <TableCell>{cell(row.difficulty)}</TableCell>
                    {showContextColumns && (
                      <>
                        <TableCell>{cell(row.variant)}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{cell(row.clinical_question)}</TableCell>
                        <TableCell>{cell(row.specialty)}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={startingKey === key}
                        onClick={() => startRun(row)}
                      >
                        {startingKey === key ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          "Start"
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
