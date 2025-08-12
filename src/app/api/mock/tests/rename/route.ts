import { NextRequest, NextResponse } from "next/server";
import { renameTest } from "../store";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { from, to } = await req.json();
    if (!from || !to || typeof from !== "string" || typeof to !== "string") {
      return NextResponse.json(
        { success: false, error: "Invalid payload. Expect { from, to }" },
        { status: 400 },
      );
    }
    const updated = await renameTest(from, to);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Rename failed" },
        { status: 400 },
      );
    }
    return NextResponse.json({ success: true, test: updated });
  } catch {
    return NextResponse.json(
      { success: false, error: "Malformed JSON body" },
      { status: 400 },
    );
  }
}
