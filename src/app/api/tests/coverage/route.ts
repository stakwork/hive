import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";
import { convertGlobsToRegex } from "@/lib/utils/glob";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { TestCoverageData } from "@/types/test-coverage";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const { searchParams, hostname } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const swarmId = searchParams.get("swarmId");
    const ignoreDirsParam = searchParams.get("ignoreDirs") || searchParams.get("ignore_dirs");
    const repoParam = searchParams.get("repo");
    const unitGlobParam = searchParams.get("unitGlob");
    const integrationGlobParam = searchParams.get("integrationGlob");
    const e2eGlobParam = searchParams.get("e2eGlob");

    let finalIgnoreDirs = ignoreDirsParam;
    let finalUnitGlob = unitGlobParam;
    let finalIntegrationGlob = integrationGlobParam;
    let finalE2eGlob = e2eGlobParam;

    if (workspaceId && !swarmId) {
      const primaryRepo = await getPrimaryRepository(workspaceId);
      if (primaryRepo) {
        if (!ignoreDirsParam) {
          finalIgnoreDirs = primaryRepo.ignoreDirs || "";
        } else if (ignoreDirsParam !== primaryRepo.ignoreDirs) {
          await db.repository.update({
            where: { id: primaryRepo.id },
            data: { ignoreDirs: ignoreDirsParam },
          });
        }

        if (!unitGlobParam) {
          finalUnitGlob = primaryRepo.unitGlob || "";
        } else if (unitGlobParam !== primaryRepo.unitGlob) {
          await db.repository.update({
            where: { id: primaryRepo.id },
            data: { unitGlob: unitGlobParam },
          });
        }

        if (!integrationGlobParam) {
          finalIntegrationGlob = primaryRepo.integrationGlob || "";
        } else if (integrationGlobParam !== primaryRepo.integrationGlob) {
          await db.repository.update({
            where: { id: primaryRepo.id },
            data: { integrationGlob: integrationGlobParam },
          });
        }

        if (!e2eGlobParam) {
          finalE2eGlob = primaryRepo.e2eGlob || "";
        } else if (e2eGlobParam !== primaryRepo.e2eGlob) {
          await db.repository.update({
            where: { id: primaryRepo.id },
            data: { e2eGlob: e2eGlobParam },
          });
        }
      }
    }

    let endpoint = "/tests/coverage";
    const params = new URLSearchParams();
    if (finalIgnoreDirs) {
      params.set("ignore_dirs", finalIgnoreDirs);
    }
    if (repoParam) {
      params.set("repo", repoParam);
    }
    if (finalUnitGlob) {
      const regex = convertGlobsToRegex(finalUnitGlob);
      if (regex) params.set("unit_regexes", regex);
    }
    if (finalIntegrationGlob) {
      const regex = convertGlobsToRegex(finalIntegrationGlob);
      if (regex) params.set("integration_regexes", regex);
    }
    if (finalE2eGlob) {
      const regex = convertGlobsToRegex(finalE2eGlob);
      if (regex) params.set("e2e_regexes", regex);
    }
    if (params.toString()) {
      endpoint += `?${params.toString()}`;
    }
    const isLocalHost =
      hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
    if (process.env.NODE_ENV === "development" && isLocalHost) {
      const url = `http://0.0.0.0:7799${endpoint}`;
      const resp = await fetch(url);
      const data = (await resp.json().catch(() => ({}))) as TestCoverageData;
      if (!resp.ok) {
        return NextResponse.json(
          { success: false, message: "Failed to fetch test coverage (dev)", details: data },
          { status: resp.status },
        );
      }

      return NextResponse.json(
        {
          success: true,
          data,
          ignoreDirs: finalIgnoreDirs || "",
        },
        { status: 200 },
      );
    }

    if (!workspaceId && !swarmId) {
      return NextResponse.json(
        { success: false, message: "Missing required parameter: workspaceId or swarmId" },
        { status: 400 },
      );
    }

    // Resolve Swarm
    const where: Record<string, string> = {};
    if (swarmId) where.swarmId = swarmId;
    if (!swarmId && workspaceId) where.workspaceId = workspaceId;
    const swarm = await db.swarm.findFirst({ where });

    if (!swarm) {
      return NextResponse.json(
        { success: false, message: "Swarm not found" },
        { status: 404 },
      );
    }

    if (!swarm.swarmUrl || !swarm.swarmApiKey) {
      return NextResponse.json(
        { success: false, message: "Test coverage is not available." },
        { status: 400 },
      );
    }

    const swarmUrlObj = new URL(swarm.swarmUrl);
    const stakgraphUrl = `https://${swarmUrlObj.hostname}:7799`;

    // Proxy to stakgraph microservice
    const apiResult = await swarmApiRequest({
      swarmUrl: stakgraphUrl,
      endpoint,
      method: "GET",
      apiKey: encryptionService.decryptField("swarmApiKey", swarm.swarmApiKey),
    });

    if (!apiResult.ok) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to fetch test coverage data",
          details: apiResult.data
        },
        { status: apiResult.status },
      );
    }

    const data = apiResult.data as TestCoverageData;

    return NextResponse.json(
      {
        success: true,
        data,
        ignoreDirs: finalIgnoreDirs || "",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching test coverage:", error);
    return NextResponse.json(
      { success: false, message: "Failed to fetch test coverage" },
      { status: 500 },
    );
  }
}