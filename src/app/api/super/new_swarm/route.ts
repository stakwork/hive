import { NextRequest, NextResponse } from "next/server";
import { CreateSwarmRequest, CreateSwarmResponse } from "@/types";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  // 1. Authenticate
  const superToken = request.headers.get("x-super-token");
  if (superToken !== process.env.SWARM_SUPERADMIN_API_KEY) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }

  // 2. Validate request body
  let body: CreateSwarmRequest;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.instance_type) {
    return NextResponse.json(
      { success: false, message: "Missing required field: instance_type" },
      { status: 400 }
    );
  }

  // 3. Mock provisioning and create response data
  // In a real implementation, this would call AWS, etc.
  const swarmId = `swarm-${crypto.randomBytes(4).toString("hex")}`;
  const ec2Id = `i-${crypto.randomBytes(8).toString("hex")}`;
  const address = `${swarmId}.example.com`;
  const apiKey = `sk-${crypto.randomBytes(16).toString("hex")}`;

  const responsePayload: CreateSwarmResponse = {
    success: true,
    message: "Swarm created successfully",
    data: {
      swarm_id: swarmId,
      address: address,
      x_api_key: apiKey,
      ec2_id: ec2Id,
    },
  };

  return NextResponse.json(responsePayload, { status: 200 });
}