import Link from "next/link";

const SURFACES = ["task_chat", "plan_chat", "plan_start", "task_start", "whiteboard", "sidebar"] as const;

function truncate(str: string, len = 80) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "…" : str;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface CorrectionEvent {
  id: string;
  surface: string;
  rawTranscript: string;
  finalText: string;
  createdAt: string;
  user: { id: string; name: string | null; email: string | null };
}

interface AggregatedRow {
  rawTranscript: string;
  finalText: string;
  surface: string;
  count: number;
}

interface PageData {
  events: { data: CorrectionEvent[]; total: number; page: number; pageSize: number };
  aggregated: AggregatedRow[];
}

async function fetchData(searchParams: Record<string, string>): Promise<PageData> {
  const { page = "1", surface, from, to } = searchParams;

  // Fetch using Prisma directly to avoid cookie/auth complexity in server component
  const { db } = await import("@/lib/db");

  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = 20;

  const surfaceFilter = surface && surface !== "all" ? { surface } : {};
  const dateFilter =
    from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {};

  const where = { ...surfaceFilter, ...dateFilter };

  const [eventsData, total, aggregatedData] = await Promise.all([
    db.voiceCorrectionLearning.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
    db.voiceCorrectionLearning.count({ where }),
    db.voiceCorrectionLearning.groupBy({
      by: ["rawTranscript", "finalText", "surface"],
      where: surface && surface !== "all" ? { surface } : undefined,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 50,
    }),
  ]);

  return {
    events: {
      data: eventsData.map((ev) => ({
        ...ev,
        createdAt: ev.createdAt.toISOString(),
      })) as CorrectionEvent[],
      total,
      page: pageNum,
      pageSize,
    },
    aggregated: aggregatedData.map((g) => ({
      rawTranscript: g.rawTranscript,
      finalText: g.finalText,
      surface: g.surface,
      count: g._count.id,
    })),
  };
}

export default async function VoiceCorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const resolvedSearchParams = await searchParams;
  const { events, aggregated } = await fetchData(resolvedSearchParams);
  const currentTab = resolvedSearchParams.tab ?? "events";
  const currentSurface = resolvedSearchParams.surface ?? "all";
  const currentPage = events.page;
  const totalPages = Math.ceil(events.total / events.pageSize);

  // Build query string helper
  function buildQuery(overrides: Record<string, string>) {
    const params = new URLSearchParams({
      tab: currentTab,
      surface: currentSurface,
      ...(resolvedSearchParams.from ? { from: resolvedSearchParams.from } : {}),
      ...(resolvedSearchParams.to ? { to: resolvedSearchParams.to } : {}),
      page: String(currentPage),
      ...overrides,
    });
    return `?${params.toString()}`;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Voice Corrections</h1>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 border-b">
        {["events", "aggregated"].map((tab) => (
          <Link
            key={tab}
            href={buildQuery({ tab, page: "1" })}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize ${
              currentTab === tab
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </Link>
        ))}
      </div>

      {currentTab === "events" && (
        <>
          {/* Filter row */}
          <form method="GET" className="flex flex-wrap gap-3 mb-6 items-end">
            <input type="hidden" name="tab" value="events" />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Surface</label>
              <select
                name="surface"
                defaultValue={currentSurface}
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                <option value="all">All surfaces</option>
                {SURFACES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">From</label>
              <input
                type="date"
                name="from"
                defaultValue={resolvedSearchParams.from ?? ""}
                className="border rounded px-2 py-1 text-sm bg-background"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">To</label>
              <input
                type="date"
                name="to"
                defaultValue={resolvedSearchParams.to ?? ""}
                className="border rounded px-2 py-1 text-sm bg-background"
              />
            </div>
            <button
              type="submit"
              className="px-3 py-1 text-sm bg-foreground text-background rounded hover:opacity-90 transition-opacity"
            >
              Filter
            </button>
            <Link
              href={buildQuery({ surface: "all", from: "", to: "", page: "1" })}
              className="px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Clear
            </Link>
          </form>

          {/* Events table */}
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Surface</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Raw Transcript</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Final Text</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {events.data.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No correction events found.
                    </td>
                  </tr>
                ) : (
                  events.data.map((ev) => (
                    <tr key={ev.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{ev.user.name ?? "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">{ev.user.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
                          {ev.surface}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <span title={ev.rawTranscript} className="text-muted-foreground">
                          {truncate(ev.rawTranscript)}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <span title={ev.finalText}>{truncate(ev.finalText)}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                        {formatDate(ev.createdAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">
              {events.total} total event{events.total !== 1 ? "s" : ""}
            </p>
            <div className="flex gap-2">
              {currentPage > 1 && (
                <Link
                  href={buildQuery({ page: String(currentPage - 1) })}
                  className="px-3 py-1 text-sm border rounded hover:bg-muted transition-colors"
                >
                  ← Previous
                </Link>
              )}
              <span className="px-3 py-1 text-sm text-muted-foreground">
                Page {currentPage} of {totalPages || 1}
              </span>
              {currentPage < totalPages && (
                <Link
                  href={buildQuery({ page: String(currentPage + 1) })}
                  className="px-3 py-1 text-sm border rounded hover:bg-muted transition-colors"
                >
                  Next →
                </Link>
              )}
            </div>
          </div>
        </>
      )}

      {currentTab === "aggregated" && (
        <>
          {/* Surface filter for aggregated */}
          <form method="GET" className="flex gap-3 mb-6 items-end">
            <input type="hidden" name="tab" value="aggregated" />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Surface</label>
              <select
                name="surface"
                defaultValue={currentSurface}
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                <option value="all">All surfaces</option>
                {SURFACES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="px-3 py-1 text-sm bg-foreground text-background rounded hover:opacity-90 transition-opacity"
            >
              Filter
            </button>
          </form>

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Raw Transcript</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Final Text</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Surface</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {aggregated.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      No aggregated corrections found.
                    </td>
                  </tr>
                ) : (
                  aggregated.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 max-w-xs">
                        <span title={row.rawTranscript} className="text-muted-foreground">
                          {truncate(row.rawTranscript)}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <span title={row.finalText}>{truncate(row.finalText)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
                          {row.surface}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{row.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Showing top 50 recurring pairs.</p>
        </>
      )}
    </div>
  );
}
