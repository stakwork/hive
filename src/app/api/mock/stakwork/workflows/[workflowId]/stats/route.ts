import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

const variants = [
  { last_run_at: "2024-03-18T14:32:10.000Z", total_runs: 42, error_rate: 0.07 },
  { last_run_at: "2024-04-02T09:15:00.000Z", total_runs: 7, error_rate: 0.0 },
  { last_run_at: null, total_runs: 0, error_rate: 0.0 },
];

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { workflowId } = await params;
  const id = parseInt(workflowId, 10);
  if (!isNaN(id) && id >= 1001 && id <= 1005) {
    return NextResponse.json({
      success: true,
      data: { available: true, last_run_at: "2026-06-17T14:32:00.000Z", total_runs: 1284, active_runs: 1, error_rate: 0.031 },
    });
  }
  const variant = variants[Math.abs(isNaN(id) ? 0 : id) % variants.length];
  return NextResponse.json({ success: true, data: { available: true, ...variant } });
}
