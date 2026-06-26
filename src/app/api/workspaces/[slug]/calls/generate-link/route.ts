import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { mintOrgToken } from "@/lib/mcp/orgTokenMint";
import { redis } from "@/lib/redis";
import jwt from "jsonwebtoken";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug: rawSlug } = await params;
    const swarmName = request.nextUrl.searchParams.get("swarmName");

    // Resolve workspace slug: use URL slug if real, otherwise look up by swarmName
    let slug = rawSlug && rawSlug !== "_" ? rawSlug : null;

    if (!slug && swarmName) {
      const swarm = await db.swarm.findUnique({
        where: { name: swarmName },
        select: { workspace: { select: { slug: true, deleted: true } } },
      });
      if (swarm?.workspace && !swarm.workspace.deleted) {
        slug = swarm.workspace.slug;
      }
    }

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug or swarmName query parameter is required" },
        { status: 400 },
      );
    }

    // Get workspace with swarm info
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      include: {
        swarm: {
          select: {
            name: true,
            status: true,
          },
        },
        members: {
          where: {
            userId: userOrResponse.id,
            leftAt: null,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    // Check user has access (owner or member)
    if (workspace.ownerId !== userOrResponse.id && workspace.members.length === 0) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      );
    }

    // Validate swarm exists and is active
    if (!workspace.swarm || workspace.swarm.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Swarm not configured or not active" },
        { status: 400 },
      );
    }

    if (!workspace.swarm.name || workspace.swarm.name.trim() === "") {
      return NextResponse.json(
        { error: "Swarm name not found" },
        { status: 400 },
      );
    }

    // Get LiveKit base URL from environment
    const liveKitBaseUrl = optionalEnvVars.LIVEKIT_CALL_BASE_URL;
    if (!liveKitBaseUrl) {
      return NextResponse.json(
        { error: "LiveKit call service not configured" },
        { status: 500 },
      );
    }

    // Mint a short-lived JWT for the agent to authenticate with the Hive API.
    //
    // Default scope is "org": the token is keyed to the workspace's
    // SourceControlOrg so the call agent can drive the org-wide `org_agent`
    // tool across every workspace in the org. Pass `?scope=workspace` to fall
    // back to a single-workspace token (the legacy swarm-tool surface).
    //
    // Both shapes carry `userId` so `verifyJwt`/`verifyOrgJwt` can re-check
    // membership at use time (memberships can be revoked between mint and use).
    const scope =
      request.nextUrl.searchParams.get("scope") === "workspace"
        ? "workspace"
        : "org";

    let hiveToken: string;
    if (scope === "workspace") {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return NextResponse.json(
          { error: "JWT secret not configured" },
          { status: 500 },
        );
      }
      hiveToken = jwt.sign(
        { slug, userId: userOrResponse.id },
        jwtSecret,
        { expiresIn: "4h" },
      );
    } else {
      if (!workspace.sourceControlOrgId) {
        return NextResponse.json(
          { error: "Workspace is not linked to a source-control org" },
          { status: 400 },
        );
      }

      const outcome = await mintOrgToken({
        orgId: workspace.sourceControlOrgId,
        userId: userOrResponse.id,
        requestedPermissions: ["read", "write"],
        purpose: "call-link",
      });

      if (!outcome.ok) {
        switch (outcome.error) {
          case "JWT_SECRET_MISSING":
            return NextResponse.json(
              { error: "JWT secret not configured" },
              { status: 500 },
            );
          case "ORG_MEMBERSHIP_REQUIRED":
            return NextResponse.json(
              { error: "Access denied" },
              { status: 403 },
            );
          case "INVALID_PERMISSIONS":
            return NextResponse.json(
              { error: "Invalid permission value" },
              { status: 400 },
            );
          default:
            return NextResponse.json(
              { error: "Failed to mint org token" },
              { status: 500 },
            );
        }
      }

      hiveToken = outcome.token;
    }

    // Store the minted token in Redis behind a short opaque key so the
    // shareable URL carries a compact callKey instead of the full JWT.
    const callKey = randomBytes(12).toString("hex"); // 24-char hex
    try {
      await redis.set("call-token:" + callKey, hiveToken, "EX", 7200);
    } catch (err) {
      console.error("[generate-link] Redis write failed:", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Generate call URL with short callKey
    const timestamp = Math.floor(Date.now() / 1000);
    const callUrl = `${liveKitBaseUrl}${workspace.swarm.name}.sphinx.chat-.${timestamp}?callKey=${callKey}`;

    return NextResponse.json({ url: callUrl });
  } catch (error) {
    console.error("Error generating call link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
