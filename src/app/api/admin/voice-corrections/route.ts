import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/** GET /api/admin/voice-corrections — paginated list of correction events. */
export async function GET(request: NextRequest) {
  const guard = await requireSuperAdmin(request);
  if (guard instanceof NextResponse) return guard;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10)));
  const userId = searchParams.get("userId") ?? undefined;
  const surface = searchParams.get("surface") ?? undefined;
  const workspaceId = searchParams.get("workspaceId") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  const where: Prisma.VoiceCorrectionLearningWhereInput = {
    ...(userId && { userId }),
    ...(surface && { surface }),
    ...(workspaceId && { workspaceId }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      },
    }),
  };

  const [data, total] = await Promise.all([
    db.voiceCorrectionLearning.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.voiceCorrectionLearning.count({ where }),
  ]);

  return NextResponse.json({ data, total, page, pageSize });
}
