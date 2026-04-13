import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/auth/api-token";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  // Allow either a valid API token or an authenticated session
  const isApiToken = validateApiToken(request);
  if (!isApiToken) {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) {
      return userOrResponse;
    }
  }

  const models = await db.llmModel.findMany({
    where: {
      OR: [{ dateEnd: null }, { dateEnd: { gt: new Date() } }],
    },
    select: {
      id: true,
      name: true,
      provider: true,
      providerLabel: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ models });
}
