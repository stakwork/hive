import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";

export const runtime = "nodejs";

/**
 * Mock endpoint for Stakwork projects API
 * POST /projects - Create a new project
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    console.log("[Mock Stakwork] Creating project:", body.title || body.name);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 100));

    const mockResponse = {
      id: Math.floor(Math.random() * 10000) + 1000,
      title: body.title,
      description: body.description,
      budget: body.budget,
      skills: body.skills || [],
      name: `[MOCK]${body.name}`,
      workflow_id: body.workflow_id,
      workflow_state: "created",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "active",
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock Stakwork projects:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}