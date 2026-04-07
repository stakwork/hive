import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  if (!validateApiToken(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const models = await db.llmModel.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ models });
}
