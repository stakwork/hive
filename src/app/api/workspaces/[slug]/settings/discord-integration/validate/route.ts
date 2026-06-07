import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { validateWorkspaceAccess } from "@/services/workspace";
import { discordUtil, extractClientIdFromToken } from "@/lib/discord";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const access = await validateWorkspaceAccess(slug, session.user.id, true);

  if (!access.canAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  let token: string | null = body.token ?? null;

  // If no token provided in body, decrypt the stored token
  if (!token) {
    const workspace = await db.workspace.findUnique({
      where: { slug },
      select: { discordBotToken: true },
    });

    if (!workspace?.discordBotToken) {
      return NextResponse.json({ valid: false, error: "No token configured" });
    }

    const encryptionService = EncryptionService.getInstance();
    token = encryptionService.decryptField("discordBotToken", workspace.discordBotToken);
  }

  try {
    const botUser = await discordUtil.validateBotToken(token);
    const clientId = extractClientIdFromToken(token);

    return NextResponse.json({
      valid: true,
      botUsername: botUser.username,
      clientId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ valid: false, error: message });
  }
}
