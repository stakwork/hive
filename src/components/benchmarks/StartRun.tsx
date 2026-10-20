"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBenchmarkTasks } from "@/hooks/useBenchmarks";

/** Task picker (when the benchmark lists tasks) or free-form JSON params, plus optional params JSON. */
export function StartRun({
  slug,
  benchmarkSlug,
  hasTaskList,
  onStarted,
}: {
  slug: string;
  benchmarkSlug: string;
  hasTaskList: boolean;
  onStarted: () => void;
}) {
  const { tasks, loading, error } = useBenchmarkTasks(slug, benchmarkSlug, hasTaskList);
  // A failed task list falls back to the free-form params input.
  const usePicker = hasTaskList && !error;
  const [taskIndex, setTaskIndex] = useState<string>("");
  const [paramsText, setParamsText] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    let params: Record<string, unknown> | undefined;
    if (paramsText.trim()) {
      try {
        const parsed = JSON.parse(paramsText);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
        params = parsed;
      } catch {
        toast.error("Params must be a JSON object");
        return;
      }
    }
    const task = usePicker ? tasks[Number(taskIndex)] : undefined;
    if (usePicker && !task) {
      toast.error("Pick a task");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/benchmarks/${benchmarkSlug}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(task ? { taskId: task.id } : {}), ...(params ? { params } : {}) }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not start the run");
      toast.success("Run started");
      onStarted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the run");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 max-w-xl">
      {hasTaskList && error && (
        <p className="text-xs text-destructive">
          {error}. Enter the run's params as JSON instead.
        </p>
      )}
      {usePicker && (
        <div className="space-y-1.5">
          <Label>Task</Label>
          <Select value={taskIndex} onValueChange={setTaskIndex} disabled={loading || tasks.length === 0}>
            <SelectTrigger>
              <SelectValue placeholder={loading ? "Loading tasks…" : tasks.length === 0 ? "No tasks" : "Pick a task"} />
            </SelectTrigger>
            <SelectContent>
              {tasks.map((t, i) => (
                <SelectItem key={String(t.id)} value={String(i)}>
                  {t.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>{usePicker ? "Params (optional JSON)" : "Params (JSON)"}</Label>
        <Textarea
          value={paramsText}
          onChange={(e) => setParamsText(e.target.value)}
          placeholder='{ "key": "value" }'
          className="font-mono text-xs min-h-[80px]"
        />
      </div>
      <Button onClick={start} disabled={busy}>
        <Play className="h-4 w-4 mr-1" /> Start run
      </Button>
    </div>
  );
}
