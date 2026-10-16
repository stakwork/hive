/**
 * Captcha sites — the hostnames a strut job may ask a person to solve a
 * captcha on, per workspace. Any member reads; owners and admins edit.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { MAX_CAPTCHA_SITES, normalizeSite, normalizeSites } from "@/lib/captcha";

const bodySchema = z.object({ captchaAllowedSites: z.array(z.string().max(300)).max(MAX_CAPTCHA_SITES) });

const memberWhere = (slug: string, userId: string, adminOnly: boolean) => ({
  slug,
  deleted: false,
  OR: [
    { ownerId: userId },
    { members: { some: { userId, leftAt: null, ...(adminOnly ? { role: { in: ["ADMIN", "OWNER"] as ("ADMIN" | "OWNER")[] } } : {}) } } },
  ],
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { slug } = await params;

    const workspace = await db.workspace.findFirst({
      where: memberWhere(slug, userId, false),
      select: { captchaAllowedSites: true },
    });
    if (!workspace) return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    return NextResponse.json({ success: true, data: { captchaAllowedSites: workspace.captchaAllowedSites ?? [] } });
  } catch (error) {
    console.error("Error fetching captcha sites:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { slug } = await params;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: `Expected { captchaAllowedSites }: at most ${MAX_CAPTCHA_SITES} hostnames` }, { status: 400 });
    }
    const invalid = parsed.data.captchaAllowedSites.filter((s) => !normalizeSite(s));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Not a hostname: ${invalid[0]}` }, { status: 400 });
    }

    const workspace = await db.workspace.findFirst({ where: memberWhere(slug, userId, true), select: { id: true } });
    if (!workspace) return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });

    const captchaAllowedSites = normalizeSites(parsed.data.captchaAllowedSites);
    await db.workspace.update({ where: { id: workspace.id }, data: { captchaAllowedSites } });
    return NextResponse.json({ success: true, data: { captchaAllowedSites } });
  } catch (error) {
    console.error("Error updating captcha sites:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
