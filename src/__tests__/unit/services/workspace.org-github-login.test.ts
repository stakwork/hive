import { describe, test, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { getWorkspaceOrgGithubLogin } from "@/services/workspace";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

const mockedFindUnique = vi.mocked(db.workspace.findUnique);

describe("getWorkspaceOrgGithubLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns githubLogin when workspace has an associated org", async () => {
    mockedFindUnique.mockResolvedValue({
      sourceControlOrg: { githubLogin: "stakwork" },
    } as never);

    const result = await getWorkspaceOrgGithubLogin("ws-123");

    expect(result).toBe("stakwork");
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "ws-123" },
      select: { sourceControlOrg: { select: { githubLogin: true } } },
    });
  });

  test("returns null when workspace has no org (sourceControlOrg is null)", async () => {
    mockedFindUnique.mockResolvedValue({
      sourceControlOrg: null,
    } as never);

    const result = await getWorkspaceOrgGithubLogin("ws-no-org");

    expect(result).toBeNull();
  });

  test("returns null when workspace does not exist", async () => {
    mockedFindUnique.mockResolvedValue(null);

    const result = await getWorkspaceOrgGithubLogin("nonexistent");

    expect(result).toBeNull();
  });
});
