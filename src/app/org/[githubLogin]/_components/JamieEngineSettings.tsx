"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { JAMIE_ENGINES, type JamieEngine } from "@/lib/ai/jamieEngine";
import { jamieName } from "@/lib/constants/jamie";

interface JamieEngineSettingsProps {
  githubLogin: string;
}

const OPTIONS: Array<{ value: JamieEngine; label: string; description: string }> = [
  {
    value: "hive",
    label: "Hive",
    description: `${jamieName} as it is today: the canvas agent with its tools, cards and approvals. The default.`,
  },
  {
    value: "strut",
    label: "Strut orchestrator",
    description:
      "Each message runs strut's orchestrator workflow on the org's swarm. Graph changes come back as proposals you accept or reject; initiatives, milestones and prompts are not available on this path yet. Start a fresh conversation after switching.",
  },
];

/**
 * Admin card: which engine answers the org canvas chat
 * (`lib/ai/jamieEngine.ts`). Reads and writes `/api/orgs/<org>/settings`.
 */
export function JamieEngineSettings({ githubLogin }: JamieEngineSettingsProps) {
  const [engine, setEngine] = useState<JamieEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<JamieEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orgs/${encodeURIComponent(githubLogin)}/settings`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 403 || res.status === 404) {
          setForbidden(true);
          return;
        }
        const body = (await res.json().catch(() => null)) as { jamieEngine?: string; error?: string } | null;
        if (!res.ok) {
          setError(body?.error ?? `Could not load settings (${res.status}).`);
          return;
        }
        setEngine(
          (JAMIE_ENGINES as readonly string[]).includes(body?.jamieEngine ?? "")
            ? (body!.jamieEngine as JamieEngine)
            : "hive",
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [githubLogin]);

  const choose = async (value: JamieEngine) => {
    if (value === engine || saving) return;
    setSaving(value);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(githubLogin)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jamieEngine: value }),
      });
      const body = (await res.json().catch(() => null)) as { jamieEngine?: JamieEngine; error?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? `Could not save (${res.status}).`);
        return;
      }
      setEngine(body?.jamieEngine ?? value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card data-testid="jamie-engine-settings">
      <CardHeader>
        <CardTitle className="text-base">{jamieName} engine</CardTitle>
        <CardDescription>
          Which engine answers the org chat. Switching changes new turns only; an open conversation on the other engine
          starts cold on strut, so start a fresh one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {forbidden ? (
          <p className="text-sm text-muted-foreground">Only workspace owners and admins can change this.</p>
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div role="radiogroup" aria-label={`${jamieName} engine`} className="space-y-2">
            {OPTIONS.map((opt) => {
              const selected = engine === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`jamie-engine-${opt.value}`}
                  disabled={saving !== null}
                  onClick={() => void choose(opt.value)}
                  className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed ${
                    selected ? "border-primary bg-primary/5" : "hover:bg-muted/60"
                  }`}
                >
                  <span
                    className={`mt-1 h-3.5 w-3.5 flex-shrink-0 rounded-full border ${selected ? "border-primary bg-primary" : "border-muted-foreground/50"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {opt.label}
                      {saving === opt.value && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{opt.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
      </CardContent>
    </Card>
  );
}
