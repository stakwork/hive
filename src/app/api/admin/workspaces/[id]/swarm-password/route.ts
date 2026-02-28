import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { EncryptionService } from "@/lib/encryption";

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
