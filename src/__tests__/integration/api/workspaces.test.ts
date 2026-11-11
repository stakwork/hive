import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/workspaces/route";
import { db } from "@/lib/db";
import {
  WORKSPACE_ERRORS,
  WORKSPACE_LIMITS,
} from "@/lib/constants";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  generateUniqueSlug,
  createPostRequest,
} from "@/__tests__/support/helpers";

describe("Workspace API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/workspaces", () => {
    test.each([
      {
        name: "creates workspace successfully",
        setup: async () => ({ user: await createTestUser() }),
        requestData: {
          name: "Test Workspace",
          description: "A test workspace",
        },
        expectedStatus: 201,
        assertions: async (response: Response, { user }: { user: any }) => {
          const data = await expectSuccess(response, 201);
          const slug = data.workspace.slug;
          expect(data.workspace).toMatchObject({
            name: "Test Workspace",
            slug,
            ownerId: user.id,
          });
        },
      },
      {
        name: "enforces workspace limit",
        setup: async () => {
          const user = await createTestUser();
          for (let index = 0; index < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; index++) {
            await createTestWorkspace({
              ownerId: user.id,
              name: `Workspace ${index + 1}`,
              slug: generateUniqueSlug(`workspace-${index + 1}`),
            });
          }
          return { user };
        },
        requestData: {
          name: "Extra Workspace",
          description: "This should fail",
        },
        expectedStatus: 400,
        assertions: async (response: Response) => {
          await expectError(response, WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED, 400);
        },
      },
      {
        name: "permits creation after workspace deletion",
        setup: async () => {
          const user = await createTestUser();
          const workspaces = [];
          for (let index = 0; index < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; index++) {
            const workspace = await createTestWorkspace({
              ownerId: user.id,
              name: `Workspace ${index + 1}`,
              slug: generateUniqueSlug(`workspace-${index + 1}`),
            });
            workspaces.push(workspace);
          }
          await db.workspace.update({
            where: { id: workspaces[0].id },
            data: { deleted: true, deletedAt: new Date() },
          });
          return { user };
        },
        requestData: {
          name: "New Workspace",
        },
        expectedStatus: 201,
        assertions: async (response: Response) => {
          const data = await expectSuccess(response, 201);
          expect(data.workspace.name).toBe("New Workspace");
        },
      },
      {
        name: "auto-suffixes duplicate slugs",
        setup: async () => {
          const user = await createTestUser();
          const slug = generateUniqueSlug("duplicate");
          await createTestWorkspace({
            ownerId: user.id,
            name: "First Workspace",
            slug,
          });
          return { user, slug };
        },
        requestData: {
          name: "Duplicate Workspace",
        },
        expectedStatus: 201,
        assertions: async (response: Response, context: any) => {
          const data = await expectSuccess(response, 201);
          expect(data.workspace.slug).toBe(`${context.slug}-1`);
        },
      },
    ])("$name", async ({ setup, requestData, assertions }) => {
      const context = await setup();
      const slug = (context as any).slug || generateUniqueSlug(requestData.name.toLowerCase().replace(/\s+/g, "-"));

      getMockedSession().mockResolvedValue(createAuthenticatedSession(context.user));

      const request = createPostRequest("http://localhost:3000/api/workspaces", {
        ...requestData,
        slug,
      });

      const response = await POST(request);
      await assertions(response, context);
    });

    test("rejects unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/workspaces", {
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("rejects missing required fields", async () => {
      const user = await createTestUser();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/workspaces", {
        description: "Missing name and slug",
      });

      const response = await POST(request);

      await expectError(response, "Missing required fields", 400);
    });

    test("persists workspaceKind when provided", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const slug = generateUniqueSlug("graph-workspace");
      const request = createPostRequest("http://localhost:3000/api/workspaces", {
        name: "Graph Workspace",
        slug,
        workspaceKind: "GRAPH",
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.workspace.workspaceKind).toBe("GRAPH");
    });

    test("creates workspace with null workspaceKind when not provided", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const slug = generateUniqueSlug("plain-workspace");
      const request = createPostRequest("http://localhost:3000/api/workspaces", {
        name: "Plain Workspace",
        slug,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.workspace.workspaceKind).toBeNull();
    });

    describe("with orgGithubLogin", () => {
      async function setupOrg() {
        const org = await db.sourceControlOrg.create({
          data: {
            githubLogin: generateUniqueSlug("org"),
            githubInstallationId: Math.floor(Math.random() * 2_000_000_000),
          },
        });
        const owner = await createTestUser();
        const orgWs = await createTestWorkspace({
          ownerId: owner.id,
          slug: generateUniqueSlug("org-ws"),
          sourceControlOrgId: org.id,
        });
        return { org, owner, orgWs };
      }
      const url = "http://localhost:3000/api/workspaces";

      test("org owner creates workspace linked to org", async () => {
        const { org, owner } = await setupOrg();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));
        const slug = generateUniqueSlug("new-org-ws");
        const res = await POST(
          createPostRequest(url, { name: "New", slug, orgGithubLogin: org.githubLogin }),
        );
        const data = await expectSuccess(res, 201);
        expect(data.workspace.sourceControlOrgId).toBe(org.id);
        expect(data.workspace.slug).toBe(slug);
      });

      test("org ADMIN member creates workspace", async () => {
        const { org, orgWs } = await setupOrg();
        const admin = await createTestUser();
        await createTestMembership({ workspaceId: orgWs.id, userId: admin.id, role: "ADMIN" });
        getMockedSession().mockResolvedValue(createAuthenticatedSession(admin));
        const res = await POST(
          createPostRequest(url, {
            name: "New",
            slug: generateUniqueSlug("admin-ws"),
            orgGithubLogin: org.githubLogin,
          }),
        );
        await expectSuccess(res, 201);
      });

      test.each(["DEVELOPER", "none"])("rejects %s with 403 and creates nothing", async (kind) => {
        const { org, orgWs } = await setupOrg();
        const user = await createTestUser();
        if (kind === "DEVELOPER") {
          await createTestMembership({ workspaceId: orgWs.id, userId: user.id, role: "DEVELOPER" });
        }
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
        const slug = generateUniqueSlug("denied");
        const res = await POST(
          createPostRequest(url, { name: "Nope", slug, orgGithubLogin: org.githubLogin }),
        );
        await expectError(res, "Only org admins can create workspaces in this organization", 403);
        expect(await db.workspace.findUnique({ where: { slug } })).toBeNull();
      });

      test("duplicate slug returns 409", async () => {
        const { org, owner, orgWs } = await setupOrg();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));
        const res = await POST(
          createPostRequest(url, { name: "Dup", slug: orgWs.slug, orgGithubLogin: org.githubLogin }),
        );
        await expectError(res, WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS, 409);
      });

      test("without orgGithubLogin sourceControlOrgId stays null", async () => {
        const user = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(user));
        const res = await POST(
          createPostRequest(url, { name: "Plain", slug: generateUniqueSlug("plain") }),
        );
        const data = await expectSuccess(res, 201);
        expect(data.workspace.sourceControlOrgId).toBeNull();
      });
    });
  });
});
