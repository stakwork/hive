import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { id } = await params;

  try {
    const existing = await db.llmModel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "LLM model not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, provider, providerLabel, inputPricePer1M, outputPricePer1M, dateStart, dateEnd, isPlanDefault, isTaskDefault } = body;

    if (isPlanDefault) {
      await db.llmModel.updateMany({ where: { isPlanDefault: true, id: { not: id } }, data: { isPlanDefault: false } });
    }
    if (isTaskDefault) {
      await db.llmModel.updateMany({ where: { isTaskDefault: true, id: { not: id } }, data: { isTaskDefault: false } });
    }

    const model = await db.llmModel.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(provider !== undefined && { provider }),
        ...(providerLabel !== undefined && { providerLabel }),
        ...(inputPricePer1M !== undefined && { inputPricePer1M: Number(inputPricePer1M) }),
        ...(outputPricePer1M !== undefined && { outputPricePer1M: Number(outputPricePer1M) }),
        ...(dateStart !== undefined && { dateStart: dateStart ? new Date(dateStart) : null }),
        ...(dateEnd !== undefined && { dateEnd: dateEnd ? new Date(dateEnd) : null }),
        ...(isPlanDefault !== undefined && { isPlanDefault }),
        ...(isTaskDefault !== undefined && { isTaskDefault }),
      },
    });

    return NextResponse.json({ model });
  } catch (error) {
    console.error("Error updating LLM model:", error);
    return NextResponse.json(
      { error: "Failed to update LLM model" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { id } = await params;

  try {
    const existing = await db.llmModel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "LLM model not found" }, { status: 404 });
    }

    await db.llmModel.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting LLM model:", error);
    return NextResponse.json(
      { error: "Failed to delete LLM model" },
      { status: 500 }
    );
  }
}
