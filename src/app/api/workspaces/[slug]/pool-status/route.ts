import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getWorkspaceBySlug } from "@/services/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    const workspace = await getWorkspaceBySlug(slug, userId);

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 },
      );
    }

    // Get swarm data for pool info
    const swarm = await db.swarm.findUnique({
      where: { workspaceId: workspace.id },
      select: {
        poolName: true,
        poolApiKey: true,
      },
    });

    if (!swarm?.poolName || !swarm?.poolApiKey) {
      return NextResponse.json(
        { error: "No pool configuration found" },
        { status: 404 },
      );
    }

    // Decrypt the pool API key
    const poolApiKeyPlain = encryptionService.decryptField(
      "poolApiKey",
      swarm.poolApiKey,
    );

    // Call pool manager API
    const baseUrl = process.env.POOL_MANAGER_BASE_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { error: "Pool manager not configured" },
        { status: 500 },
      );
    }

    const poolResponse = await fetch(`${baseUrl}/api/pools/${swarm.poolName}`, {
      headers: {
        Authorization: `Bearer ${poolApiKeyPlain}`,
      },
    });

    if (!poolResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch pool status" },
        { status: poolResponse.status },
      );
    }

    const poolData = await poolResponse.json();

    // Extract only the status info we need
    const status = {
      running_vms: poolData.status?.running_vms || 0,
      pending_vms: poolData.status?.pending_vms || 0,
      failed_vms: poolData.status?.failed_vms || 0,
    };

    return NextResponse.json({ status });
  } catch (error) {
    console.error("Error fetching pool status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}