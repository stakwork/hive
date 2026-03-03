import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { POD_BASE_DOMAIN } from "@/lib/pods/queries";

export const fetchCache = "force-no-store";

const encryptionService = EncryptionService.getInstance();

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const task = await db.task.findUnique({
      where: { id: taskId, deleted: false },
      select: { id: true, workspaceId: true, agentPassword: true, podId: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const access = await validateWorkspaceAccessById(task.workspaceId, session.user.id);
    if (!access.hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Local dev / pod not yet claimed
    if (!task.agentPassword || !task.podId) {
      return NextResponse.json({ token: null });
    }

    const encryptedData = JSON.parse(task.agentPassword);
    const password = encryptionService.decryptField("agentPassword", encryptedData);

    const expires = Math.floor(Date.now() / 1000) + 55; // 55s TTL
    const token = crypto
      .createHmac("sha256", password)
      .update(`ide-auth:${expires}`)
      .digest("hex");

    return NextResponse.json({
      token,
      expires,
      ideUrl: `https://${task.podId}.${POD_BASE_DOMAIN}`,
    });
  } catch (error) {
    console.error("Error generating IDE token:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
