import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth/nextauth";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import { decryptEnvVars, encryptEnvVars, EncryptionService } from "@/lib/encryption";
import { z } from "zod";
import { getSwarmCmdJwt, swarmCmdRequest } from "@/services/swarm/cmd";

export const runtime = "nodejs";

const ENV_KEY = "HIVE_NEO4J_CONFIG";

const neo4jConfigSchema = z.object({
  heap_initial_gb: z.number().min(1).max(256),
  heap_max_gb: z.number().min(1).max(256),
  pagecache_gb: z.number().min(1).max(512),
  tx_total_gb: z.number().min(1).max(512),
  tx_max_gb: z.number().min(1).max(512),
  checkpoint_iops: z.number().min(1).max(100000),
});

const putSchema = z.object({
  config: neo4jConfigSchema,
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const access = await validateWorkspaceAccess(slug, userId);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
  }
  if (!access.canAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const workspaceId = access.workspace?.id;
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: {
      swarmUrl: true,
      environmentVariables: true,
    },
  });

  if (!swarm?.swarmUrl) {
    return NextResponse.json({ error: "Swarm not configured" }, { status: 404 });
  }

  let config: unknown = null;
  try {
    const envVarsRaw = (swarm.environmentVariables as unknown as Array<{ name: string; value: unknown }>) || [];
    const envVars = decryptEnvVars(envVarsRaw);
    const stored = envVars.find((v) => v.name === ENV_KEY)?.value;
    config = stored ? JSON.parse(stored) : null;
  } catch {
    config = null;
  }

  return NextResponse.json({
    config,
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const access = await validateWorkspaceAccess(slug, userId);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
  }
  if (!access.canAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const workspaceId = access.workspace?.id;
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const body = await request.json();
  const validated = putSchema.safeParse(body);
  if (!validated.success) {
    return NextResponse.json(
      { error: "Invalid request data", details: validated.error.flatten() },
      { status: 400 },
    );
  }

  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { swarmUrl: true, swarmPassword: true },
  });

  if (!swarm?.swarmUrl) {
    return NextResponse.json({ error: "Swarm not configured" }, { status: 404 });
  }

  if (!swarm.swarmPassword) {
    return NextResponse.json(
      { error: "Swarm password not set; cannot authenticate for swarm commands" },
      { status: 400 },
    );
  }

  const encryptionService = EncryptionService.getInstance();
  let swarmPassword: string;
  try {
    swarmPassword = encryptionService.decryptField("swarmPassword", swarm.swarmPassword);
  } catch {
    return NextResponse.json(
      { error: "Failed to decrypt swarm password" },
      { status: 500 },
    );
  }

  let jwt: string;
  try {
    jwt = await getSwarmCmdJwt(swarm.swarmUrl, swarmPassword);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Swarm login failed";
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }

  const config = validated.data.config;

  const updateRes = await swarmCmdRequest({
    swarmUrl: swarm.swarmUrl,
    jwt,
    cmd: {
      type: "Swarm",
      data: {
        cmd: "UpdateNeo4jConfig",
        content: config,
      },
    },
  });

  if (!updateRes.ok) {
    return NextResponse.json(
      {
        error: "Failed to update Neo4j config on swarm",
        status: updateRes.status,
        swarm: updateRes.data ?? updateRes.rawText,
      },
      { status: 502 },
    );
  }

  const restartRes = await swarmCmdRequest({
    swarmUrl: swarm.swarmUrl,
    jwt,
    cmd: {
      type: "Swarm",
      data: {
        cmd: "RestartContainer",
        content: "neo4j",
      },
    },
  });

  if (!restartRes.ok) {
    return NextResponse.json(
      {
        error: "Neo4j config updated, but restart failed",
        status: restartRes.status,
        swarm: restartRes.data ?? restartRes.rawText,
      },
      { status: 502 },
    );
  }

  // Persist for UI display and auditability
  const swarmWithEnv = await db.swarm.findUnique({
    where: { workspaceId },
    select: { environmentVariables: true },
  });

  const currentEnvVarsRaw =
    (swarmWithEnv?.environmentVariables as unknown as Array<{ name: string; value: unknown }>) || [];
  const currentEnvVars = decryptEnvVars(currentEnvVarsRaw);
  const nextEnvVars = [
    ...currentEnvVars.filter((v) => v.name !== ENV_KEY),
    { name: ENV_KEY, value: JSON.stringify(config) },
  ];

  await db.swarm.update({
    where: { workspaceId },
    data: {
      environmentVariables: encryptEnvVars(nextEnvVars) as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    success: true,
    update: updateRes.data ?? updateRes.rawText,
    restart: restartRes.data ?? restartRes.rawText,
  });
}

