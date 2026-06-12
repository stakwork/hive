import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type RouteParams = {
  params: Promise<{ workflowId: string }>;
};

const variants = [
  [
    {
      id: 1001,
      name: "Run #1001",
      status: "finished",
      started_at: "2024-03-18T14:00:00.000Z",
      finished_at: "2024-03-18T14:32:10.000Z",
    },
    {
      id: 1002,
      name: "Run #1002",
      status: "error",
      started_at: "2024-03-17T09:00:00.000Z",
      finished_at: "2024-03-17T09:15:00.000Z",
    },
  ],
  [
    {
      id: 2001,
      name: "Run #2001",
      status: "halted",
      started_at: "2024-04-01T10:00:00.000Z",
      finished_at: "2024-04-01T10:05:00.000Z",
    },
    {
      id: 2002,
      name: "Run #2002",
      status: "active",
      started_at: "2024-04-02T09:00:00.000Z",
      finished_at: null,
    },
  ],
  [],
];

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { workflowId } = await params;
  const id = parseInt(workflowId, 10);
  const variant = variants[Math.abs(isNaN(id) ? 0 : id) % variants.length];
  return NextResponse.json({ success: true, data: { runs: variant } });
}
