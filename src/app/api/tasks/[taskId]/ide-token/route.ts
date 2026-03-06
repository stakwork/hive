import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { POD_BASE_DOMAIN } from "@/lib/pods/queries";

const encryptionService = EncryptionService.getInstance();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;

  const context = getMiddlewareContext(request);
  const userOrResponse = requireAuth(context);
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const task = await db.task.findUnique({
    where: { id: taskId, deleted: false },
    select: { id: true, workspaceId: true, agentPassword: true, podId: true },
  });

  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const access = await validateWorkspaceAccessById(task.workspaceId, userOrResponse.id);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Local dev / pod not yet claimed
  if (!task.agentPassword || !task.podId) {
    return NextResponse.json({ token: null });
  }

  const password = encryptionService.decryptField("agentPassword", task.agentPassword);

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
}
