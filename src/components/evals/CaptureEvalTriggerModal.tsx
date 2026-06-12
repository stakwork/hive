import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { TagInput } from "@/components/ui/tag-input";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { JarvisNode } from "@/types/jarvis";

export interface CaptureEvalTriggerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evalSetId: string;
  reqId: string;
  onCreated: () => void;
}

interface Step1Fields {
  agent: string;
  start_point: string;
  end_point: string;
  environment: string;
  change_type: string;
  run_count: number;
  desirable_cases: string[];
  undesirable_cases: string[];
}

interface AgentRole extends JarvisNode {
  properties: {
    name?: string;
    description?: string;
    [key: string]: unknown;
  };
}

interface AgentSession extends JarvisNode {
  properties: {
    name?: string;
    created_at?: string;
    [key: string]: unknown;
  };
}

const INITIAL_STEP1: Step1Fields = {
  agent: "",
  start_point: "",
  end_point: "",
  environment: "",
  change_type: "",
  run_count: 1,
  desirable_cases: [],
  undesirable_cases: [],
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function CaptureEvalTriggerModal({
  open,
  onOpenChange,
  evalSetId,
  reqId,
  onCreated,
}: CaptureEvalTriggerModalProps) {
  const { slug } = useWorkspace();
  const [step, setStep] = useState<1 | 2>(1);
  const [fields, setFields] = useState<Step1Fields>(INITIAL_STEP1);

  // Step 2 state
  const [roleFilter, setRoleFilter] = useState("");
  const debouncedFilter = useDebounce(roleFilter, 300);
  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setStep(1);
      setFields(INITIAL_STEP1);
      setRoleFilter("");
      setRoles([]);
      setSelectedRoleId(null);
      setSessions([]);
      setSelectedSessionId(null);
    }
  }, [open]);

  // Fetch roles when filter changes (step 2)
  const fetchRoles = useCallback(
    async (name: string) => {
      setRolesLoading(true);
      try {
        const url = `/api/workspaces/${slug}/evals/agent-roles${name ? `?name=${encodeURIComponent(name)}` : ""}`;
        const res = await fetch(url);
        const data = await res.json();
        setRoles(data?.data?.nodes ?? []);
      } catch {
        setRoles([]);
      } finally {
        setRolesLoading(false);
      }
    },
    [slug],
  );

  useEffect(() => {
    if (step === 2) {
      fetchRoles(debouncedFilter);
    }
  }, [step, debouncedFilter, fetchRoles]);

  // Fetch sessions when a role is selected
  useEffect(() => {
    if (!selectedRoleId) {
      setSessions([]);
      setSelectedSessionId(null);
      return;
    }
    setSessionsLoading(true);
    fetch(
      `/api/workspaces/${slug}/evals/sessions?role_ref_id=${encodeURIComponent(selectedRoleId)}`,
    )
      .then((res) => res.json())
      .then((data) => setSessions(data?.data?.nodes ?? []))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, [selectedRoleId, slug]);

  function handleField<K extends keyof Step1Fields>(key: K, value: Step1Fields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function isStep1Valid() {
    return (
      fields.agent.trim() &&
      fields.start_point.trim() &&
      fields.end_point.trim() &&
      fields.environment.trim() &&
      fields.run_count > 0
    );
  }

  async function handleConfirm() {
    if (!selectedSessionId) {
      toast.error("Please select a session");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        agent: fields.agent,
        start_point: fields.start_point,
        end_point: fields.end_point,
        environment: fields.environment,
        run_count: fields.run_count,
        desirable_cases: fields.desirable_cases,
        undesirable_cases: fields.undesirable_cases,
        session_ref_id: selectedSessionId,
      };
      if (fields.change_type.trim()) {
        payload.change_type = fields.change_type;
      }

      const res = await fetch(
        `/api/workspaces/${slug}/evals/${evalSetId}/requirements/${reqId}/triggers`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error("Request failed");
      toast.success("Eval trigger captured");
      onCreated();
      onOpenChange(false);
    } catch {
      toast.error("Failed to capture eval trigger");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Capture Eval Trigger — Step 1 of 2" : "Select Session — Step 2 of 2"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="agent">Agent *</Label>
              <Input
                id="agent"
                value={fields.agent}
                onChange={(e) => handleField("agent", e.target.value)}
                placeholder="e.g. Code Reviewer"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="start_point">Start Point *</Label>
                <Input
                  id="start_point"
                  value={fields.start_point}
                  onChange={(e) => handleField("start_point", e.target.value)}
                  placeholder="e.g. PR opened"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end_point">End Point *</Label>
                <Input
                  id="end_point"
                  value={fields.end_point}
                  onChange={(e) => handleField("end_point", e.target.value)}
                  placeholder="e.g. Review submitted"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="environment">Environment *</Label>
                <Input
                  id="environment"
                  value={fields.environment}
                  onChange={(e) => handleField("environment", e.target.value)}
                  placeholder="e.g. staging"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="change_type">Change Type (optional)</Label>
                <Input
                  id="change_type"
                  value={fields.change_type}
                  onChange={(e) => handleField("change_type", e.target.value)}
                  placeholder="e.g. feature"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="run_count">Run Count *</Label>
              <Input
                id="run_count"
                type="number"
                min={1}
                value={fields.run_count}
                onChange={(e) => handleField("run_count", Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Positive Cases</Label>
              <TagInput
                id="desirable_cases"
                items={fields.desirable_cases}
                onChange={(items) => handleField("desirable_cases", items)}
                placeholder="Type and press Enter"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Negative Cases</Label>
              <TagInput
                id="undesirable_cases"
                items={fields.undesirable_cases}
                onChange={(items) => handleField("undesirable_cases", items)}
                placeholder="Type and press Enter"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="role_filter">Filter by Role Name</Label>
              <Input
                id="role_filter"
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setSelectedRoleId(null);
                }}
                placeholder="Search roles..."
                data-testid="role-filter-input"
              />
            </div>

            {rolesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-1 max-h-36 overflow-y-auto rounded border p-1">
                {roles.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">No roles found</p>
                ) : (
                  roles.map((role) => (
                    <button
                      key={role.ref_id}
                      type="button"
                      data-testid="role-option"
                      onClick={() => setSelectedRoleId(role.ref_id)}
                      className={`w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                        selectedRoleId === role.ref_id
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      }`}
                    >
                      <span className="font-medium">{String(role.properties?.name ?? role.ref_id)}</span>
                      {role.properties?.description && (
                        <span className="ml-2 text-xs opacity-70">
                          {String(role.properties.description)}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}

            {selectedRoleId && (
              <div className="space-y-1.5">
                <Label>Select Session</Label>
                {sessionsLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sessions found for this role</p>
                ) : (
                  <div className="space-y-1 max-h-40 overflow-y-auto rounded border p-1">
                    {sessions.map((session) => {
                      const name = String(session.properties?.name ?? session.ref_id);
                      const date = session.properties?.created_at
                        ? new Date(String(session.properties.created_at)).toLocaleDateString()
                        : null;
                      return (
                        <label
                          key={session.ref_id}
                          data-testid="session-option"
                          className={`flex cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm transition-colors ${
                            selectedSessionId === session.ref_id ? "bg-muted" : "hover:bg-muted/50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="session"
                            checked={selectedSessionId === session.ref_id}
                            onChange={() => setSelectedSessionId(session.ref_id)}
                            className="shrink-0"
                          />
                          <span className="flex-1 font-medium">{name}</span>
                          {date && <span className="text-xs text-muted-foreground">{date}</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 2 && (
            <Button variant="outline" onClick={() => setStep(1)} disabled={submitting}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          {step === 1 ? (
            <Button
              onClick={() => setStep(2)}
              disabled={!isStep1Valid()}
              data-testid="next-step-btn"
            >
              Next
            </Button>
          ) : (
            <Button
              onClick={handleConfirm}
              disabled={!selectedSessionId || submitting}
              data-testid="confirm-btn"
            >
              {submitting ? "Saving…" : "Capture Trigger"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
