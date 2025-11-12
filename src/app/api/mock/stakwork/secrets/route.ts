import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";

export const runtime = "nodejs";

/**
 * Mock endpoint for Stakwork secrets API
 * POST /secrets - Create a new secret
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const secretName = body.secret?.name || body.name;
    console.log("[Mock Stakwork] Creating secret:", secretName);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 50));

    const mockResponse = {
      id: Math.floor(Math.random() * 1000) + 500,
      name: `[MOCK]${secretName}`,
      source: body.source || "hive",
      created_at: new Date().toISOString(),
      status: "stored",
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock Stakwork secrets:", error);
    return NextResponse.json({ error: "Failed to create secret" }, { status: 500 });
  }
}