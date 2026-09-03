/**
 * End-to-end guard for HTML pages as root-canvas cards.
 *
 * Seeded mock-S3 fixture rows must:
 *   1. Appear as `html:<id>` cards on the root canvas
 *   2. Return `slug` (never shareRef/s3Key) from the node-detail endpoint
 *   3. Serve the on-disk fixture bytes from the body proxy
 *
 * This exists because S3MockState is process-local: a seed script that
 * only writes HtmlPage rows would 404 in the body proxy unless the mock
 * S3 wrapper hydrates fixtures from disk on first access.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createAuthenticatedGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { htmlPageFixtureS3Key } from "@/lib/mock/html-fixtures";
import { GET as getCanvas } from "@/app/api/orgs/[githubLogin]/canvas/route";
import { GET as getNodeDetail } from "@/app/api/orgs/[githubLogin]/canvas/node/[liveId]/route";
import { GET as getHtmlBody } from "@/app/api/orgs/[githubLogin]/html-pages/[slug]/route";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/services/s3", async () => {
  const { getMockS3Service } = await import("@/lib/mock/s3-wrapper");
  return { getS3Service: getMockS3Service };
});

let installationIdCounter = 930100;
function nextInstallationId() {
  return installationIdCounter++;
}

async function createOrg(githubLogin: string) {
  return db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: nextInstallationId(),
      type: "ORG",
      name: githubLogin,
      avatarUrl: `https://avatars.githubusercontent.com/u/${nextInstallationId()}?v=4`,
    },
  });
}

async function createWorkspaceInOrg(ownerId: string, orgId: string) {
  const slug = `ws-${generateUniqueId()}`;
  return db.workspace.create({
    data: {
      name: slug,
      slug,
      ownerId,
      sourceControlOrgId: orgId,
    },
  });
}

const createdOrgIds: string[] = [];
const createdWorkspaceIds: string[] = [];
const createdUserIds: string[] = [];
const createdHtmlPageIds: string[] = [];

afterEach(async () => {
  if (createdHtmlPageIds.length > 0) {
    await db.htmlPage.deleteMany({ where: { id: { in: createdHtmlPageIds } } });
    createdHtmlPageIds.length = 0;
  }
  if (createdWorkspaceIds.length > 0) {
    await db.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    createdWorkspaceIds.length = 0;
  }
  if (createdOrgIds.length > 0) {
    await db.sourceControlOrg.deleteMany({ where: { id: { in: createdOrgIds } } });
    createdOrgIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
});

describe("HTML pages on the org root canvas (fixture-hydrated mock S3)", () => {
  it("projects a seeded fixture page, returns slug from node-detail, and serves fixture bytes", async () => {
    const user = await createTestUser();
    createdUserIds.push(user.id);
    const githubLogin = `org-${generateUniqueId()}`;
    const org = await createOrg(githubLogin);
    createdOrgIds.push(org.id);
    const ws = await createWorkspaceInOrg(user.id, org.id);
    createdWorkspaceIds.push(ws.id);

    const filename = "hive-vs-workspaces.html";
    const slug = "hive-vs-workspaces";
    const fixturePath = path.join(process.cwd(), "src/lib/mock/fixtures/html", filename);
    const fixtureBytes = fs.readFileSync(fixturePath);
    const s3Key = htmlPageFixtureS3Key(org.id, filename);

    const page = await db.htmlPage.create({
      data: {
        orgId: org.id,
        slug,
        title: "Hive vs Workspaces",
        s3Key,
        size: fixtureBytes.length,
        contentType: "text/html; charset=utf-8",
        createdBy: user.id,
      },
    });
    createdHtmlPageIds.push(page.id);

    const canvasReq = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/canvas`,
      user,
    );
    const canvasRes = await getCanvas(canvasReq, {
      params: Promise.resolve({ githubLogin }),
    });
    expect(canvasRes.status).toBe(200);
    const canvasBody = await canvasRes.json();
    const htmlNodes = (canvasBody.data.nodes as Array<{ id: string; category?: string; customData?: Record<string, unknown> }>).filter(
      (n) => n.id.startsWith("html:"),
    );
    expect(htmlNodes).toHaveLength(1);
    expect(htmlNodes[0].id).toBe(`html:${page.id}`);
    expect(htmlNodes[0].category).toBe("html");
    expect(htmlNodes[0].customData).toEqual({
      slug,
      title: "Hive vs Workspaces",
    });
    expect(htmlNodes[0].customData).not.toHaveProperty("shareRef");
    expect(htmlNodes[0].customData).not.toHaveProperty("s3Key");

    const liveId = `html:${page.id}`;
    const detailReq = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/canvas/node/${encodeURIComponent(liveId)}`,
      user,
    );
    const detailRes = await getNodeDetail(detailReq, {
      params: Promise.resolve({ githubLogin, liveId }),
    });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.kind).toBe("html");
    expect(detail.extras.slug).toBe(slug);
    expect(detail.extras).not.toHaveProperty("shareRef");
    expect(detail.extras).not.toHaveProperty("s3Key");

    const bodyReq = createAuthenticatedGetRequest(
      `http://localhost:3000/api/orgs/${githubLogin}/html-pages/${slug}`,
      user,
    );
    const bodyRes = await getHtmlBody(bodyReq, {
      params: Promise.resolve({ githubLogin, slug }),
    });
    expect(bodyRes.status).toBe(200);
    const served = Buffer.from(await bodyRes.arrayBuffer());
    expect(served.equals(fixtureBytes)).toBe(true);
  });
});
