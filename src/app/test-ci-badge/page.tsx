import { PRStatusBadge } from "@/components/tasks/PRStatusBadge";

export default function TestCIBadgePage() {
  return (
    <div className="p-10 space-y-8 bg-background min-h-screen">
      <h1 className="text-xl font-semibold">PRStatusBadge — CI Status Variants</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Open PR</h2>
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex flex-col gap-1 items-start">
            <span className="text-xs text-muted-foreground">No CI yet</span>
            <PRStatusBadge url="#" status="IN_PROGRESS" />
          </div>
          <div className="flex flex-col gap-1 items-start">
            <span className="text-xs text-muted-foreground">CI pending</span>
            <PRStatusBadge url="#" status="IN_PROGRESS" ciStatus="pending" ciSummary="Checks running…" />
          </div>
          <div className="flex flex-col gap-1 items-start">
            <span className="text-xs text-muted-foreground">CI passing</span>
            <PRStatusBadge url="#" status="IN_PROGRESS" ciStatus="success" ciSummary="5/5 passed" />
          </div>
          <div className="flex flex-col gap-1 items-start">
            <span className="text-xs text-muted-foreground">CI failing</span>
            <PRStatusBadge url="#" status="IN_PROGRESS" ciStatus="failure" ciSummary="build: failed" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Closed / Merged — no CI icon</h2>
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex flex-col gap-1 items-start">
            <span className="text-xs text-muted-foreground">Merged (ciStatus ignored)</span>
            <PRStatusBadge url="#" status="DONE" ciStatus="success" ciSummary="5/5 passed" />
          </div>
          <div className="flex flex-col gap-1 items-start">
            <span className="text-xs text-muted-foreground">Closed (ciStatus ignored)</span>
            <PRStatusBadge url="#" status="CANCELLED" ciStatus="failure" ciSummary="build: failed" />
          </div>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">Hover the CI icon to see the tooltip (ciSummary).</p>
    </div>
  );
}
