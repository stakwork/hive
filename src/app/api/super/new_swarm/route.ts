import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // Stub implementation - return proper Response object
  return new Response(
    JSON.stringify({ 
      success: false, 
      message: "Endpoint not implemented" 
    }),
    { 
      status: 501,
      headers: { "Content-Type": "application/json" }
    }
  );
}
