import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { EncryptionService } from "@/lib/encryption";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { logger } from "@/lib/logger";

const encryptionService = EncryptionService.getInstance();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Require super admin access
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { id: workspaceId } = await params;

  // Look up the swarm for this workspace
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { swarmPassword: true },
  });

  // Return 404 if no swarm or no password
  if (!swarm || !swarm.swarmPassword) {
    return NextResponse.json(
      { error: "Swarm password not found" },
      { status: 404 }
    );
  }

  // Decrypt the password
  try {
    const decryptedPassword = encryptionService.decryptField(
      "swarmPassword",
      swarm.swarmPassword
    );

    return NextResponse.json({ password: decryptedPassword });
  } catch (error) {
    console.error("Failed to decrypt swarm password:", error);
    return NextResponse.json(
      { error: "Failed to decrypt password" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { id: workspaceId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const swarmPassword =
    body && typeof body === "object" && "swarmPassword" in body
      ? (body as { swarmPassword: unknown }).swarmPassword
      : undefined;

  if (typeof swarmPassword !== "string") {
    return NextResponse.json(
      { error: "swarmPassword must be a string" },
      { status: 400 }
    );
  }

  const trimmedPassword = swarmPassword.trim();
  if (!trimmedPassword) {
    return NextResponse.json(
      { error: "swarmPassword cannot be empty" },
      { status: 400 }
    );
  }

  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { id: true },
  });

  if (!swarm) {
    return NextResponse.json(
      { error: "Swarm not found" },
      { status: 404 }
    );
  }

  await saveOrUpdateSwarm({ workspaceId, swarmPassword: trimmedPassword });

  logger.info("swarm password updated", "ADMIN_SWARM_PASSWORD", {
    userId: authResult.userId,
    workspaceId,
  });

  return NextResponse.json({ success: true });
}
