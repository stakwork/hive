import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getUserAppTokens } from "@/lib/githubApp";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ hasTokens: false }, { status: 200 });
    }

    // Check if user has GitHub App tokens
    const tokens = await getUserAppTokens(session.user.id);
    const hasTokens = !!(tokens?.accessToken && tokens?.refreshToken);

    return NextResponse.json({ hasTokens }, { status: 200 });
  } catch (error) {
    console.error("Failed to check GitHub App status", error);
    return NextResponse.json({ hasTokens: false }, { status: 200 });
  }
}
