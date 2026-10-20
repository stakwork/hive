"use client";

import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useWorkspace } from "@/hooks/useWorkspace";
import { BENCHMARKS, benchmarkVisibleIn } from "@/lib/benchmarks/registry";

export default function BenchmarksIndexPage() {
  const { workspace } = useWorkspace();
  if (!workspace) return null;
  const visible = BENCHMARKS.filter((b) => benchmarkVisibleIn(b, workspace.slug));
  return (
    <div className="flex flex-col h-full">
      <PageHeader icon={FlaskConical} title="Benchmarks" description="Registered benchmarks you can run on strut" />
      <div className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((b) => (
          <Link key={b.slug} href={`/w/${workspace.slug}/benchmarks/${b.slug}`}>
            <Card className="hover:bg-muted/50 transition-colors">
              <CardHeader>
                <CardTitle className="text-base">{b.name}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
        {visible.length === 0 && <p className="text-sm text-muted-foreground">No benchmarks registered for this workspace.</p>}
      </div>
    </div>
  );
}
