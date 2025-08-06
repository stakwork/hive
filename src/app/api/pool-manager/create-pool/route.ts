import { serviceConfigs } from "@/config/services";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { PoolManagerService } from "@/services/pool-manager/PoolManagerService";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { EncryptedData, EnvironmentVariable, type ApiError } from "@/types";
import { generateRandomPassword } from "@/utils/randomPassword";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    const user = await db.user.findUnique({
      where: {
        email: session?.user.email || "",
      },
    });

    let poolApiKey = encryptionService.encryptField(
      "poolApiKey",
      user?.poolApiKey || "",
    ).data;

    if (!poolApiKey) {
      console.log(session?.user);
    } else {
      console.log(poolApiKey);
    }

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!session.user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { swarmId, workspaceId, container_files } = body;

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    // Find the swarm and verify user has access to the workspace
    const swarm = await db.swarm.findFirst({
      where: {
        ...(swarmId ? { swarmId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      },
      include: {
        workspace: {
          select: {
            id: true,
            ownerId: true,
            members: {
              where: { userId },
              select: { role: true },
            },
          },
        },
      },
    });

    const github_pat = await getGithubUsernameAndPAT(session?.user.id);

    const password = generateRandomPassword(12);

    console.log(
      "--------------------------------password--------------------------------",
    );
    console.log(password);
    console.log(
      "--------------------------------password--------------------------------",
    );

    if (!poolApiKey) {
      console.log(
        "--------------------------------login--------------------------------",
      );
      const loginResponse = await fetch(
        "https://workspaces.sphinx.chat/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: "admin",
            password: env.POOL_MANAGER_API_PASSWORD,
          }),
        },
      );

      const loginData = await loginResponse.json();

      const poolManager = new PoolManagerService({
        baseURL: "https://workspaces.sphinx.chat/api",
        apiKey: loginData.token,
        headers: {
          Authorization: `Bearer ${loginData.token}`,
        },
      });

      console.log(
        "--------------------------------createUser--------------------------------",
      );
      console.log(session.user.email);
      console.log(password);
      console.log((session.user.name || "").toLowerCase());
      console.log(
        "--------------------------------createUser--------------------------------",
      );

      const sanitizedName = (session.user.name || "").replace(/\s+/g, "");

      try {
        const { user: poolUser } = await poolManager.createUser({
          email: session.user.email,
          password,
          username: `${sanitizedName}-${swarmId}`.toLowerCase(),
        });

        await db.user.update({
          where: {
            email: session?.user.email || "",
          },
          data: {
            poolApiKey: encryptionService.encryptField("poolApiKey", poolApiKey)
              .data,
          },
        });

        console.log(poolUser, "poolUser");

        if (!poolUser) {
          return NextResponse.json(
            { error: "Failed to create pool user" },
            { status: 500 },
          );
        }

        poolApiKey = encryptionService.encryptField(
          "poolApiKey",
          poolUser.authentication_token,
        ).data;
      } catch (error) {
        console.error("Error creating pool user:", error);
        return NextResponse.json(
          { error: "Failed to create pool user" },
          { status: 500 },
        );
      }
    }

    saveOrUpdateSwarm({
      swarmId,
      workspaceId,
      containerFiles: container_files,
    });

    if (!swarm) {
      return NextResponse.json({ error: "Swarm not found" }, { status: 404 });
    }

    // Check if user has access to the workspace
    if (!swarm.workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    const isOwner = swarm.workspace.ownerId === userId;
    const isMember = swarm.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Validate required fields
    if (!swarm.id) {
      return NextResponse.json(
        { error: "Missing required field: name" },
        { status: 400 },
      );
    }

    const repository = await db.repository.findFirst({
      where: {
        workspaceId: swarm.workspaceId,
      },
    });

    const account = await db.account.findFirst({
      where: {
        userId: session?.user.id,
      },
    });

    console.log(account, "account---account");
    console.log(repository, "repository---repository");
    console.log(swarm, "swarm---swarm");

    const poolManager = new PoolManagerService({
      ...serviceConfigs.poolManager,
      headers: {
        Authorization: `Bearer ${encryptionService.decryptField(
          "poolApiKey",
          poolApiKey as unknown as EncryptedData,
        )}`,
      },
    });

    console.log(
      "--------------------------------createPool--------------------------------",
    );
    console.log(
      encryptionService.decryptField(
        "poolApiKey",
        poolApiKey as unknown as EncryptedData,
      ),
    );
    console.log(
      "--------------------------------createPool--------------------------------",
    );

    let envVars: EnvironmentVariable[] = [
      {
        name: "MY_ENV",
        value: "MY_VALUE",
      },
    ];
    if (typeof swarm.environmentVariables === "string") {
      envVars = JSON.parse(swarm.environmentVariables) as EnvironmentVariable[];
    } else if (Array.isArray(swarm.environmentVariables)) {
      envVars = swarm.environmentVariables as unknown as EnvironmentVariable[];
    }

    const pool = await poolManager.createPool({
      pool_name: swarm.id,
      minimum_vms: 2,
      repo_name: repository?.repositoryUrl || "",
      branch_name: repository?.branch || "",
      github_pat: encryptionService.encryptField(
        "access_token",
        account?.access_token || "",
      ).data,
      github_username: github_pat?.username || "",
      env_vars: envVars,
      container_files,
    });

    saveOrUpdateSwarm({
      swarmId,
      workspaceId,
      poolName: swarmId,
    });

    return NextResponse.json({ pool }, { status: 201 });
  } catch (error) {
    console.error("Error creating Pool Manager pool:", error);

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json(
      { error: "Failed to create pool" },
      { status: 500 },
    );
  }
}
