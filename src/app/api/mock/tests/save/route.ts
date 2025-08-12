import { NextRequest, NextResponse } from "next/server";
import { saveTest } from "../store";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { name, text } = await req.json();
    if (
      !name ||
      typeof name !== "string" ||
      !text ||
      typeof text !== "string"
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid payload. Expect { name, text }" },
        { status: 400 },
      );
    }
    const saved = await saveTest(name, text);
    return NextResponse.json({ success: true, test: saved });
  } catch {
    return NextResponse.json(
      { success: false, error: "Malformed JSON body" },
      { status: 400 },
    );
  }
}
