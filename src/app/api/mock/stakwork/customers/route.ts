import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";

export const runtime = "nodejs";

/**
 * Mock endpoint for Stakwork customers API
 * POST /customers - Create a new customer
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const customerName = body.customer?.name || body.name;
    console.log("[Mock Stakwork] Creating customer:", customerName);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 300 + 50));

    const mockResponse = {
      id: Math.floor(Math.random() * 1000) + 100,
      name: `[MOCK]${customerName}`,
      created_at: new Date().toISOString(),
      status: "active",
      billing_status: "current",
    };

    return NextResponse.json(mockResponse);
  } catch (error) {
    console.error("Error in mock Stakwork customers:", error);
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
  }
}