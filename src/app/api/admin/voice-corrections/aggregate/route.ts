import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

/** GET /api/admin/voice-corrections/aggregate — top recurring correction pairs. */
export async function GET(request: NextRequest) {
  const guard = await requireSuperAdmin(request);
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(request.url);
  const surface = searchParams.get("surface") ?? undefined;

  const groups = await db.voiceCorrectionLearning.groupBy({
    by: ["rawTranscript", "finalText", "surface"],
    where: surface ? { surface } : undefined,
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 50,
  });

  const data = groups.map((g) => ({
    rawTranscript: g.rawTranscript,
    finalText: g.finalText,
    surface: g.surface,
    count: g._count.id,
  }));

  return NextResponse.json(data);
}
