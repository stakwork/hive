import { NextResponse } from "next/server";
import { listTests } from "../store";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET() {
  const tests = (await listTests()).map((t) => ({
    name: t.name,
    created: t.created,
    modified: t.modified,
    size: t.size,
  }));
  return NextResponse.json({ success: true, tests });
}
