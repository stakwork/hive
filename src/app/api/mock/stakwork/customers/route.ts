import { NextRequest, NextResponse } from "next/server";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { customer } = body;

    if (!customer?.name) {
      return NextResponse.json(
        { error: "Customer name required" },
        { status: 400 }
      );
    }

    const result = mockStakworkState.createCustomer(customer.name);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Mock Stakwork create customer error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}