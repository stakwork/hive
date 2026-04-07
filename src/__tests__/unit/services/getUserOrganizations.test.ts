import { describe, test, expect, vi, beforeEach } from "vitest";
import { getUserOrganizations } from "@/services/workspace";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    sourceControlOrg: {
      findMany: vi.fn(),
    },
  },
}));

// Suppress encryption/config imports pulled in transitively by workspace service
vi.mock("@/lib/encryption", () => ({
  EncryptionService: { getInstance: () => ({ decryptField: vi.fn(() => "key") }) },
}));
vi.mock("@/config/services", () => ({ getServiceConfig: vi.fn() }));
vi.mock("@/services/swarm", () => ({ SwarmService: class {} }));

describe("getUserOrganizations", () => {
  const userId = "user-abc";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns orgs accessible via owned workspaces", async () => {
    const mockOrgs = [
      {
        id: "org-1",
        githubLogin: "stakwork",
        name: "Stakwork",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        type: "ORG",
      },
    ];

    (db.sourceControlOrg.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockOrgs);

    const result = await getUserOrganizations(userId);

    expect(db.sourceControlOrg.findMany).toHaveBeenCalledWith({
      where: {
        workspaces: {
          some: {
            deleted: false,
            OR: [
              { ownerId: userId },
              { members: { some: { userId, leftAt: null } } },
            ],
          },
        },
      },
      select: {
        id: true,
        githubLogin: true,
        name: true,
        avatarUrl: true,
        type: true,
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "org-1",
      githubLogin: "stakwork",
      name: "Stakwork",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      type: "ORG",
    });
  });

  test("returns orgs accessible via member workspaces", async () => {
    const mockOrgs = [
      {
        id: "org-2",
        githubLogin: "tomsmith8",
        name: null,
        avatarUrl: null,
        type: "USER",
      },
    ];

    (db.sourceControlOrg.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockOrgs);

    const result = await getUserOrganizations(userId);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "org-2",
      githubLogin: "tomsmith8",
      name: null,
      avatarUrl: null,
      type: "USER",
    });
  });

  test("returns empty array when user has no accessible workspaces", async () => {
    (db.sourceControlOrg.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getUserOrganizations(userId);

    expect(result).toEqual([]);
  });

  test("returns multiple orgs deduped by Prisma (one entry per org)", async () => {
    const mockOrgs = [
      { id: "org-1", githubLogin: "orgA", name: "Org A", avatarUrl: null, type: "ORG" },
      { id: "org-2", githubLogin: "orgB", name: "Org B", avatarUrl: null, type: "USER" },
    ];

    (db.sourceControlOrg.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockOrgs);

    const result = await getUserOrganizations(userId);

    expect(result).toHaveLength(2);
    expect(result.map((o) => o.githubLogin)).toEqual(["orgA", "orgB"]);
  });
});
