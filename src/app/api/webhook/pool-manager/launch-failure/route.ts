import { NextRequest, NextResponse } from "next/server";
import { PodLaunchFailureWebhookSchema } from "@/types/pool-manager";
import { processPodLaunchFailure } from "@/services/pod-launch-failure";

export async function POST(request: NextRequest) {
  // Verify API token (used by Pool Manager webhook)
  const apiToken = request.headers.get("x-api-token");
  if (!apiToken || apiToken !== process.env.API_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse and validate payload
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = PodLaunchFailureWebhookSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: result.error.flatten() },
      { status: 400 }
    );
  }

  // Process the failure
  const response = await processPodLaunchFailure(result.data);

  if (!response.success) {
    return NextResponse.json(response, { status: 422 });
  }

  return NextResponse.json(response);
}
