import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { EncryptionService } from "@/lib/encryption";
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

    let finalIgnoreDirs = ignoreDirsParam;

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
      }
    }

    let endpoint = "/tests/coverage";
    if (finalIgnoreDirs) {
      endpoint += `?ignore_dirs=${encodeURIComponent(finalIgnoreDirs)}`;
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

      // For E2E tests: set total = covered so it displays as 100%
      if (data.e2e_tests && data.e2e_tests.covered !== undefined) {
        data.e2e_tests.total = data.e2e_tests.covered;
        data.e2e_tests.percent = data.e2e_tests.covered > 0 ? 100 : 0;
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

    // For E2E tests: set total = covered so it displays as 100%
    if (data.e2e_tests && data.e2e_tests.covered !== undefined) {
      data.e2e_tests.total = data.e2e_tests.covered;
      data.e2e_tests.percent = data.e2e_tests.covered > 0 ? 100 : 0;
    }

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