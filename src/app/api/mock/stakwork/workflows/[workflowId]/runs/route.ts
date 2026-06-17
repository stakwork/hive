import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

// Rich, status-varied run list for the workflows surfaced by
// /api/workflow/recent (ids 1001-1005). Gives the inspector real data to
// render — every status colour appears and the list is long enough to scroll.
const populated = [
  { id: 88012, name: "Generate Architecture — payments service", status: "active", started_at: "2026-06-17T14:32:00.000Z", finished_at: null },
  { id: 88008, name: "User stories: onboarding revamp", status: "finished", started_at: "2026-06-17T13:58:00.000Z", finished_at: "2026-06-17T13:59:42.000Z" },
  { id: 88004, name: "Pod repair — graphmindset-prod", status: "error", started_at: "2026-06-17T12:11:00.000Z", finished_at: "2026-06-17T12:11:09.000Z" },
  { id: 87990, name: "Task generation: dependency coordinator", status: "completed", started_at: "2026-06-17T10:46:00.000Z", finished_at: "2026-06-17T10:49:28.000Z" },
  { id: 87955, name: "Janitor analysis — coverage sweep", status: "halted", started_at: "2026-06-16T22:03:00.000Z", finished_at: "2026-06-16T22:08:51.000Z" },
  { id: 87901, name: "Generate Architecture — auth refactor", status: "finished", started_at: "2026-06-16T19:20:00.000Z", finished_at: "2026-06-16T19:22:14.000Z" },
  { id: 87870, name: "User stories: billing portal", status: "finished", started_at: "2026-06-16T15:42:00.000Z", finished_at: "2026-06-16T15:43:58.000Z" },
  { id: 87844, name: "Task generation: notifications epic", status: "completed", started_at: "2026-06-16T11:08:00.000Z", finished_at: "2026-06-16T11:10:41.000Z" },
  { id: 87810, name: "Janitor analysis — dead code sweep", status: "finished", started_at: "2026-06-15T20:55:00.000Z", finished_at: "2026-06-15T20:59:17.000Z" },
  { id: 87777, name: "Pod repair — analytics-staging", status: "error", started_at: "2026-06-15T18:30:00.000Z", finished_at: "2026-06-15T18:30:12.000Z" },
];

const variants = [
  [
    { id: 1001, name: "Run #1001", status: "finished", started_at: "2024-03-18T14:00:00.000Z", finished_at: "2024-03-18T14:32:10.000Z" },
    { id: 1002, name: "Run #1002", status: "error", started_at: "2024-03-17T09:00:00.000Z", finished_at: "2024-03-17T09:15:00.000Z" },
    { id: 1003, name: "Run #1003", status: "completed", started_at: "2024-03-16T08:00:00.000Z", finished_at: "2024-03-16T08:45:00.000Z" },
  ],
  [
    { id: 2001, name: "Run #2001", status: "halted", started_at: "2024-04-01T10:00:00.000Z", finished_at: "2024-04-01T10:05:00.000Z" },
    { id: 2002, name: "Run #2002", status: "active", started_at: "2024-04-02T09:00:00.000Z", finished_at: null },
  ],
  [],
];

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { workflowId } = await params;
  const id = parseInt(workflowId, 10);
  if (!isNaN(id) && id >= 1001 && id <= 1005) {
    return NextResponse.json({ success: true, data: { runs: populated } });
  }
  const variant = variants[Math.abs(isNaN(id) ? 0 : id) % variants.length];
  return NextResponse.json({ success: true, data: { runs: variant } });
}
