"use client";
import { PRStatusBadge } from "@/components/tasks/PRStatusBadge";

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-center gap-6">
    <span className="w-48 text-xs text-muted-foreground shrink-0">{label}</span>
    <div className="flex items-center gap-3">{children}</div>
  </div>
);

export default function TestCIBadgePage() {
  return (
    <div className="p-10 space-y-10 bg-background min-h-screen max-w-2xl">
      <div>
        <h1 className="text-base font-semibold mb-1">PR Badge — CI Status Variants</h1>
        <p className="text-xs text-muted-foreground">Hover the CI pill for the summary tooltip.</p>
      </div>

      {/* Open PR states */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Open PR</h2>
        <div className="space-y-3">
          <Row label="No CI yet">
            <PRStatusBadge url="#" status="IN_PROGRESS" />
          </Row>
          <Row label="CI pending">
            <PRStatusBadge url="#" status="IN_PROGRESS" ciStatus="pending" ciSummary="Checks running…" />
          </Row>
          <Row label="CI passing">
            <PRStatusBadge url="#" status="IN_PROGRESS" ciStatus="success" ciSummary="5/5 checks passed" />
          </Row>
          <Row label="CI failing">
            <PRStatusBadge url="#" status="IN_PROGRESS" ciStatus="failure" ciSummary="build: failed · 2 checks failed" />
          </Row>
        </div>
      </section>

      {/* Closed/Merged — no CI */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Merged / Closed</h2>
        <div className="space-y-3">
          <Row label="Merged (CI ignored)">
            <PRStatusBadge url="#" status="DONE" ciStatus="success" ciSummary="5/5 passed" />
          </Row>
          <Row label="Closed (CI ignored)">
            <PRStatusBadge url="#" status="CANCELLED" ciStatus="failure" ciSummary="build: failed" />
          </Row>
        </div>
      </section>

      {/* Compact card row simulation */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-widest">In context — compact task row</h2>
        <div className="border rounded-md divide-y divide-border">
          {[
            { title: "Fix authentication middleware", ci: undefined },
            { title: "Add retry logic to webhook handler", ci: "pending" as const, summary: "Checks running…" },
            { title: "Refactor task coordinator cron", ci: "success" as const, summary: "6/6 checks passed" },
            { title: "Update Prisma schema for new fields", ci: "failure" as const, summary: "build: failed" },
          ].map(({ title, ci, summary }) => (
            <div key={title} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-foreground truncate mr-4">{title}</span>
              <PRStatusBadge url="#" status="IN_PROGRESS" ciStatus={ci} ciSummary={summary} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
