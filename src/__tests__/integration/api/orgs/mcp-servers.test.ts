import { describe, it, expect, afterEach } from "vitest";
import {
  createAuthenticatedDeleteRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
  createAuthenticatedPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/orgs/[githubLogin]/mcp-servers/route";
import { DELETE, PATCH } from "@/app/api/orgs/[githubLogin]/mcp-servers/[serverId]/route";

// ─── helpers ────────────────────────────────────────────────────────────────

let installationIdCounter = 910000;
function nextInstallationId() {
  return installationIdCounter++;
}

async function createOrgWithWorkspace(githubLogin: string, ownerId: string) {
  const org = await db.sourceControlOrg.create({
    data: {
      githubLogin,
      githubInstallationId: nextInstallationId(),
      type: "ORG",
      name: githubLogin,
    },
  });
  const slug = `ws-mcp-${generateUniqueId()}`;
  const workspace = await db.workspace.create({
    data: {
      name: slug,
      slug,
      ownerId,
      sourceControlOrgId: org.id,
    },
  });
  createdOrgIds.push(org.id);
  createdWorkspaceIds.push(workspace.id);
  return { org, workspace };
}

function listParams(githubLogin: string) {
  return { params: Promise.resolve({ githubLogin }) };
}

function itemParams(githubLogin: string, serverId: string) {
  return { params: Promise.resolve({ githubLogin, serverId }) };
}

const BASE = "http://localhost:3000/api/orgs";

// ─── cleanup ────────────────────────────────────────────────────────────────

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const createdWorkspaceIds: string[] = [];

afterEach(async () => {
  // OrgMcpServer rows cascade with the org delete.
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

async function makeUser() {
  const user = await createTestUser({ name: "MCP Admin" });
  createdUserIds.push(user.id);
  return { id: user.id, email: user.email ?? "", name: user.name ?? "" };
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("org MCP servers CRUD", () => {
  it("creates a server, encrypts headers at rest, and never returns header values", async () => {
    const user = await makeUser();
    const login = `mcp-org-${generateUniqueId()}`;
    const { org } = await createOrgWithWorkspace(login, user.id);

    const secret = `super-secret-${generateUniqueId()}`;
    const res = await POST(
      createAuthenticatedPostRequest(`${BASE}/${login}/mcp-servers`, user, {
        name: "linear",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: `Bearer ${secret}` },
        toolFilter: ["create_issue"],
      }),
      listParams(login),
    );
    expect(res.status).toBe(201);
    const { server } = await res.json();
    expect(server.name).toBe("linear");
    expect(server.url).toBe("https://mcp.example.com/mcp");
    expect(server.toolFilter).toEqual(["create_issue"]);
    expect(server.enabled).toBe(true);
    // Key names only — value never round-trips.
    expect(server.headerKeys).toEqual(["Authorization"]);
    expect(JSON.stringify(server)).not.toContain(secret);

    // Stored encrypted, not plaintext.
    const row = await db.orgMcpServer.findFirst({
      where: { sourceControlOrgId: org.id, name: "linear" },
    });
    expect(row?.headers).toBeTruthy();
    expect(row!.headers!).not.toContain(secret);
    const parsed = JSON.parse(row!.headers!);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("iv");
  });

  it("rejects invalid names and duplicate names", async () => {
    const user = await makeUser();
    const login = `mcp-org-${generateUniqueId()}`;
    await createOrgWithWorkspace(login, user.id);

    const bad = await POST(
      createAuthenticatedPostRequest(`${BASE}/${login}/mcp-servers`, user, {
        name: "has spaces!",
        url: "https://mcp.example.com/mcp",
      }),
      listParams(login),
    );
    expect(bad.status).toBe(400);

    const first = await POST(
      createAuthenticatedPostRequest(`${BASE}/${login}/mcp-servers`, user, {
        name: "dup",
        url: "https://mcp.example.com/mcp",
      }),
      listParams(login),
    );
    expect(first.status).toBe(201);

    const second = await POST(
      createAuthenticatedPostRequest(`${BASE}/${login}/mcp-servers`, user, {
        name: "dup",
        url: "https://other.example.com/mcp",
      }),
      listParams(login),
    );
    expect(second.status).toBe(409);
  });

  it("lists servers for admins and 404s for non-members", async () => {
    const user = await makeUser();
    const outsider = await makeUser();
    const login = `mcp-org-${generateUniqueId()}`;
    const { org } = await createOrgWithWorkspace(login, user.id);
    await db.orgMcpServer.create({
      data: {
        sourceControlOrgId: org.id,
        name: "docs",
        url: "https://docs.example.com/mcp",
      },
    });

    const ok = await GET(createAuthenticatedGetRequest(`${BASE}/${login}/mcp-servers`, user), listParams(login));
    expect(ok.status).toBe(200);
    const { servers } = await ok.json();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("docs");

    const denied = await GET(
      createAuthenticatedGetRequest(`${BASE}/${login}/mcp-servers`, outsider),
      listParams(login),
    );
    expect(denied.status).toBe(404);
  });

  it("404s for non-admin members", async () => {
    const owner = await makeUser();
    const dev = await makeUser();
    const login = `mcp-org-${generateUniqueId()}`;
    const { workspace } = await createOrgWithWorkspace(login, owner.id);
    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: dev.id, role: "DEVELOPER" },
    });

    const denied = await GET(createAuthenticatedGetRequest(`${BASE}/${login}/mcp-servers`, dev), listParams(login));
    expect(denied.status).toBe(404);
  });

  it("patches fields, keeps headers when omitted, clears them on null", async () => {
    const user = await makeUser();
    const login = `mcp-org-${generateUniqueId()}`;
    await createOrgWithWorkspace(login, user.id);

    const created = await POST(
      createAuthenticatedPostRequest(`${BASE}/${login}/mcp-servers`, user, {
        name: "gh",
        url: "https://gh.example.com/mcp",
        headers: { "X-Api-Key": "abc123" },
      }),
      listParams(login),
    );
    const { server } = await created.json();

    // Headers omitted → kept.
    const patched = await PATCH(
      createAuthenticatedPatchRequest(
        `${BASE}/${login}/mcp-servers/${server.id}`,
        { url: "https://gh2.example.com/mcp", enabled: false, toolFilter: ["search"] },
        user,
      ),
      itemParams(login, server.id),
    );
    expect(patched.status).toBe(200);
    const { server: updated } = await patched.json();
    expect(updated.url).toBe("https://gh2.example.com/mcp");
    expect(updated.enabled).toBe(false);
    expect(updated.toolFilter).toEqual(["search"]);
    expect(updated.headerKeys).toEqual(["X-Api-Key"]);

    // headers: null → cleared.
    const cleared = await PATCH(
      createAuthenticatedPatchRequest(`${BASE}/${login}/mcp-servers/${server.id}`, { headers: null }, user),
      itemParams(login, server.id),
    );
    expect(cleared.status).toBe(200);
    const { server: clearedServer } = await cleared.json();
    expect(clearedServer.headerKeys).toEqual([]);
  });

  it("scopes item routes to the org (foreign serverId 404s) and deletes", async () => {
    const user = await makeUser();
    const loginA = `mcp-org-a-${generateUniqueId()}`;
    const loginB = `mcp-org-b-${generateUniqueId()}`;
    const { org: orgA } = await createOrgWithWorkspace(loginA, user.id);
    await createOrgWithWorkspace(loginB, user.id);

    const rowA = await db.orgMcpServer.create({
      data: { sourceControlOrgId: orgA.id, name: "a", url: "https://a.example.com/mcp" },
    });

    // Same user is admin of both orgs, but the server belongs to org A.
    const cross = await DELETE(
      createAuthenticatedDeleteRequest(`${BASE}/${loginB}/mcp-servers/${rowA.id}`, user),
      itemParams(loginB, rowA.id),
    );
    expect(cross.status).toBe(404);

    const del = await DELETE(
      createAuthenticatedDeleteRequest(`${BASE}/${loginA}/mcp-servers/${rowA.id}`, user),
      itemParams(loginA, rowA.id),
    );
    expect(del.status).toBe(200);
    expect(await db.orgMcpServer.findUnique({ where: { id: rowA.id } })).toBeNull();
  });
});
