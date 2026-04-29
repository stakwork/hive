import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const models = await db.llmModel.findMany({
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ models });
  } catch (error) {
    console.error("Error fetching LLM models:", error);
    return NextResponse.json(
      { error: "Failed to fetch LLM models" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const body = await request.json();
    const { name, provider, providerLabel, inputPricePer1M, outputPricePer1M, cacheReadPer1MToken, cacheWritePer1MToken, dateStart, dateEnd, isPlanDefault, isTaskDefault, isPublic } = body;

    if (!name || !provider || inputPricePer1M == null || outputPricePer1M == null) {
      return NextResponse.json(
        { error: "name, provider, inputPricePer1M, and outputPricePer1M are required" },
        { status: 400 }
      );
    }

    if (isPlanDefault) {
      await db.llmModel.updateMany({ where: { isPlanDefault: true }, data: { isPlanDefault: false } });
    }
    if (isTaskDefault) {
      await db.llmModel.updateMany({ where: { isTaskDefault: true }, data: { isTaskDefault: false } });
    }

    const model = await db.llmModel.create({
      data: {
        name,
        provider,
        providerLabel: providerLabel ?? null,
        inputPricePer1M: Number(inputPricePer1M),
        outputPricePer1M: Number(outputPricePer1M),
        cacheReadPer1MToken: cacheReadPer1MToken != null ? Number(cacheReadPer1MToken) : null,
        cacheWritePer1MToken: cacheWritePer1MToken != null ? Number(cacheWritePer1MToken) : null,
        dateStart: dateStart ? new Date(dateStart) : null,
        dateEnd: dateEnd ? new Date(dateEnd) : null,
        isPlanDefault: isPlanDefault ?? false,
        isTaskDefault: isTaskDefault ?? false,
        isPublic: isPublic ?? false,
      },
    });

    return NextResponse.json({ model }, { status: 201 });
  } catch (error) {
    console.error("Error creating LLM model:", error);
    return NextResponse.json(
      { error: "Failed to create LLM model" },
      { status: 500 }
    );
  }
}
