import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { createJanitorRun } from "@/services/janitor";


export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; type: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, type } = await params;
    
    const run = await createJanitorRun(
      slug,
      userId,
      type,
      "MANUAL"
    );

    return NextResponse.json({
      success: true,
      run: {
        id: run.id,
        janitorType: run.janitorType,
        status: run.status,
        triggeredBy: run.triggeredBy,
        createdAt: run.createdAt,
      }
    });
  } catch (error) {
    console.error("Error triggering janitor run:", error);
    
    if (error instanceof Error) {
      if (error.message.includes("not enabled")) {
        return NextResponse.json(
          { error: "This janitor type is not enabled" },
          { status: 400 }
        );
      }
      if (error.message.includes("already in progress")) {
        return NextResponse.json(
          { error: "A janitor run of this type is already in progress" },
          { status: 409 }
        );
      }
      if (error.message.includes("Invalid janitor type")) {
        return NextResponse.json(
          { error: "Invalid janitor type" },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
