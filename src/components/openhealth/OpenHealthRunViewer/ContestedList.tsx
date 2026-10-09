"use client";

import React from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { OpenHealthContest, OpenHealthContestRejected } from "@/types/openhealth";
import { CONTESTED_TEXT, describeGoldList } from "../parts";

/**
 * The answer-key items a run's score excludes as contested, each with why
 * and the quotes that show it, and the contests the workflow refused. Sits
 * beside Matched / Missed / Extra.
 */
export function ContestedList({
  contested,
  rejected,
}: {
  contested: OpenHealthContest[];
  rejected: OpenHealthContestRejected[];
}) {
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  return (
    <div className="rounded-lg border border-violet-500/40 bg-card" data-testid="openhealth-run-contested">
      <div className="border-b px-4 py-2">
        <p className={`text-sm font-semibold ${CONTESTED_TEXT}`}>
          Contested <span className="font-normal tabular-nums text-muted-foreground">{contested.length}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          In the answer key, but the chart contradicts it: excluded from the score
        </p>
      </div>
      {contested.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="divide-y text-sm">
          {contested.map((item, index) => (
            <li
              key={item.id ?? `${item.name}-${index}`}
              className="space-y-1.5 px-4 py-2"
              data-testid="openhealth-contest"
            >
              <p>
                <span className="font-medium">{item.name}</span>
                {item.icd10 && <span className="ml-1 font-mono text-xs text-muted-foreground">{item.icd10}</span>}
                {item.list && (
                  <span className="ml-1 text-xs text-muted-foreground">in {describeGoldList(item.list)}</span>
                )}
              </p>
              {item.reason && <p className="text-xs text-muted-foreground">{item.reason}</p>}
              {item.evidence.length > 0 && (
                <ul className="space-y-0.5" data-testid="openhealth-contest-evidence">
                  {item.evidence.map((quote) => (
                    <li key={quote} className="border-l-2 border-violet-500/40 pl-2 font-mono text-xs">
                      {quote}
                    </li>
                  ))}
                </ul>
              )}
              {item.refId && slug && (
                <Link
                  href={`/w/${slug}/context/graph?ref_id=${encodeURIComponent(item.refId)}`}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  data-testid="openhealth-contest-graph"
                >
                  Open in the graph
                  <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {rejected.length > 0 && (
        <div className="border-t" data-testid="openhealth-run-contests-rejected">
          <p className="px-4 pt-2 text-xs text-muted-foreground">
            Contests the workflow refused: they do not affect the score
          </p>
          <ul className="divide-y text-sm">
            {rejected.map((item, index) => (
              <li key={`${item.error}-${index}`} className="px-4 py-2 text-muted-foreground">
                <span className="font-medium">{item.error}</span>
                {item.reason && <span className="block text-xs">{item.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
