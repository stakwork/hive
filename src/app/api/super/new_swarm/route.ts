import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { z } from "zod";
import { randomBytes } from "crypto";

// This is a mock provisioning function. In a real application, this would
// interact with a cloud provider like AWS to create an EC2 instance.
async function provisionSwarm(instance_type: string) {
  // Simulate async operation
  await new Promise(resolve => setTimeout(resolve, 50));

  // Simulate a failure for a specific instance type for testing error handling
  if (instance_type === "fail_provisioning") {
    throw new Error("Failed to provision EC2 instance");
  }

  // Generate fake data
  const swarm_id = `swarm-${randomBytes(4).toString("hex")}`;
  const address = `${swarm_id}.example.com`;
  const x_api_key = `sk-${randomBytes(16).toString("hex")}`;
  const ec2_id = `i-${randomBytes(8).toString("hex")}`;

  return { swarm_id, address, x_api_key, ec2_id };
}


const createSwarmRequestSchema = z.object({
  instance_type: z.string().min(1, { message: "instance_type is required" }),
  password: z.string().optional(),
});


export async function POST(request: NextRequest) {
  // 1. Authentication
  const superToken = request.headers.get("x-super-token");
  if (superToken !== env.SWARM_SUPERADMIN_API_KEY) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Validation
    const body = await request.json();
    const validatedBody = createSwarmRequestSchema.safeParse(body);

    if (!validatedBody.success) {
      return NextResponse.json(
        { success: false, message: "Invalid request body", errors: validatedBody.error.flatten() },
        { status: 400 }
      );
    }
    
    const { instance_type } = validatedBody.data;

    // 3. Provisioning (can be mocked in tests)
    const swarmDetails = await provisionSwarm(instance_type);

    // 4. Success Response
    return NextResponse.json({
      success: true,
      message: "Swarm created successfully",
      data: swarmDetails,
    });

  } catch (error) {
    console.error("Error creating new swarm:", error);
    if (error instanceof Error) {
         return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: false, message: "An unexpected error occurred" }, { status: 500 });
  }
}