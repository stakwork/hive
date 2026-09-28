"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

interface Diagnosis {
  icd10: string;
  name: string;
  acuity: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnoses(value: unknown): Diagnosis[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((d) => ({
    icd10: typeof d.icd10 === "string" ? d.icd10 : "",
    name: typeof d.name === "string" ? d.name : "",
    acuity: typeof d.acuity === "string" ? d.acuity : "",
  }));
}

/** The model's answer: `{ active_diagnoses, chronic_conditions }`. Null when the file is not one. */
function parseProblemList(text: string): Array<{ title: string; items: Diagnosis[] }> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) return null;
    return [
      { title: "Active diagnoses", items: diagnoses(parsed.active_diagnoses) },
      { title: "Chronic conditions", items: diagnoses(parsed.chronic_conditions) },
    ];
  } catch {
    return null;
  }
}

function ProblemList({ text }: { text: string }) {
  const groups = parseProblemList(text);
  if (!groups) return <pre className="overflow-auto p-4 font-mono text-xs">{text}</pre>;
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="mb-2 text-sm font-semibold">
            {group.title} <span className="font-normal tabular-nums text-muted-foreground">{group.items.length}</span>
          </p>
          <ul className="divide-y rounded-md border text-sm">
            {group.items.map((d, index) => (
              <li key={`${d.icd10}-${index}`} className="flex items-center gap-3 px-3 py-2">
                <span className="w-16 shrink-0 font-mono text-xs">{d.icd10}</span>
                <span className="min-w-0 flex-1">{d.name}</span>
                {d.acuity && <Badge variant="outline">{d.acuity.replace(/_/g, " ")}</Badge>}
              </li>
            ))}
            {group.items.length === 0 && <li className="px-3 py-2 text-muted-foreground">None</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** One of the run's files, fetched when its panel opens. */
export function ArtifactPanel({ endpoint, kind }: { endpoint: string; kind: "problem-list" | "markdown" }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "The run has no such file." : "Could not load the file.");
        const body = await response.text();
        if (!stale) setText(body);
      })
      .catch((e: unknown) => {
        if (!stale) setError(e instanceof Error ? e.message : "Could not load the file.");
      });
    return () => {
      stale = true;
    };
  }, [endpoint]);

  if (error) return <p className="p-4 text-sm text-muted-foreground">{error}</p>;
  if (text === null) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </p>
    );
  }
  if (kind === "problem-list") return <ProblemList text={text} />;
  return (
    <div className="max-h-[640px] overflow-auto p-4">
      <MarkdownRenderer size="compact">{text}</MarkdownRenderer>
    </div>
  );
}
