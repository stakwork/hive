import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    success: true,
    data: {
      reqRefId: `mock-req-${randomUUID()}`,
      triggerRefId: `mock-trigger-${randomUUID()}`,
      sessionRefId: "session-1",
    },
  });
}
