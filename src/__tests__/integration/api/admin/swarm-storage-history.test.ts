import { describe, it, expect, beforeEach } from "vitest";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/factories";
import { createTestWorkspaceScenario } from "@/__tests__/support/factories/workspace.factory";
import { createTestSwarm } from "@/__tests__/support/factories/swarm.factory";
import {
  createAuthenticatedGetRequest,
  createGetRequest,
} from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId } from "@/__tests__/support/helpers";
import { utcCalendarDate } from "@/services/swarm/storage-janitor";

async function importRoute() {
  const { GET } = await import("@/app/api/admin/swarms/storage/route");
  return GET;
}

function utcDateOffset(daysAgo: number): Date {
  const date = utcCalendarDate();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
}

describe("GET /api/admin/swarms/storage", () => {
  let superAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: UserRole.SUPER_ADMIN,
      email: `superadmin-storage-hist-${Date.now()}@test.com`,
    });
    regularUser = await createTestUser({
      role: UserRole.USER,
      email: `regular-storage-hist-${Date.now()}@test.com`,
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const GET = await importRoute();
    const request = createGetRequest("/api/admin/swarms/storage");
    const response = await GET(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 403 for non-superadmin users without querying snapshots", async () => {
    const GET = await importRoute();
    const request = createAuthenticatedGetRequest("/api/admin/swarms/storage", regularUser);
    const response = await GET(request);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
  });

  it("returns latest snapshot with services, BigInt columns as numbers, and no Swarm secrets", async () => {
    const GET = await importRoute();
    const instanceId = `i-${generateUniqueId().replace(/[^0-9a-f]/g, "0").slice(0, 12)}`;
    const { workspace } = await createTestWorkspaceScenario({});
    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `storage-hist-${generateUniqueId()}`,
      swarmPassword: "super-secret-swarm-password",
      swarmApiKey: "super-secret-api-key",
      ec2Id: instanceId,
    });

    const olderDate = utcDateOffset(2);
    const latestDate = utcDateOffset(0);
    const total = BigInt(500 * 1024 * 1024 * 1024);
    const usedOlder = BigInt(180 * 1024 * 1024 * 1024);
    const usedLatest = BigInt(200 * 1024 * 1024 * 1024);

    await db.swarmStorageSnapshot.create({
      data: {
        instanceId,
        swarmId: swarm.id,
        date: olderDate,
        status: "OK",
        reasonCode: null,
        totalBytes: total,
        usedBytes: usedOlder,
        freeBytes: total - usedOlder,
        mount: "/",
        services: [{ name: "neo4j", sizeBytes: 10 * 1024 * 1024 * 1024, sizeKnown: true }],
        hostVisible: true,
        source: "node_exporter",
        collectedAt: new Date(olderDate.getTime() + 3 * 60 * 60 * 1000),
      },
    });

    await db.swarmStorageSnapshot.create({
      data: {
        instanceId,
        swarmId: swarm.id,
        date: latestDate,
        status: "OK",
        reasonCode: null,
        totalBytes: total,
        usedBytes: usedLatest,
        freeBytes: total - usedLatest,
        mount: "/",
        services: [
          { name: "neo4j", sizeBytes: 12 * 1024 * 1024 * 1024, sizeKnown: true },
          { name: "elasticsearch", sizeBytes: 8 * 1024 * 1024 * 1024, sizeKnown: true },
        ],
        hostVisible: true,
        source: "node_exporter",
        collectedAt: new Date(latestDate.getTime() + 3 * 60 * 60 * 1000),
      },
    });

    const request = createAuthenticatedGetRequest("/api/admin/swarms/storage", superAdminUser);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("swarmPassword");
    expect(serialized).not.toContain("swarmApiKey");
    expect(serialized).not.toContain("super-secret-swarm-password");
    expect(serialized).not.toContain("super-secret-api-key");
    expect(serialized).not.toContain("poolApiKey");

    const entry = body[instanceId];
    expect(entry).toBeDefined();
    expect(entry.latest).toBeTruthy();
    expect(Array.isArray(entry.latest.services)).toBe(true);
    expect(entry.latest.services).toEqual([
      { name: "neo4j", sizeBytes: 12 * 1024 * 1024 * 1024, sizeKnown: true },
      { name: "elasticsearch", sizeBytes: 8 * 1024 * 1024 * 1024, sizeKnown: true },
    ]);
    expect(typeof entry.latest.usedBytes).toBe("number");
    expect(typeof entry.latest.totalBytes).toBe("number");
    expect(typeof entry.latest.freeBytes).toBe("number");
    expect(entry.latest.usedBytes).toBe(Number(usedLatest));
    expect(entry.latest.totalBytes).toBe(Number(total));
    expect(entry.history).toHaveLength(2);
    expect(entry.history[0].date <= entry.history[1].date).toBe(true);
    expect(entry.history[0]).not.toHaveProperty("services");
    expect(entry.history[1]).not.toHaveProperty("services");
    expect(entry.latest).not.toHaveProperty("swarmPassword");
  });
});
