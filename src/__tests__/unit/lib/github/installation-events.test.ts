import { describe, it, expect, vi, beforeEach } from "vitest";
import { isInstallationChange, notifyInstallationChange } from "@/lib/github/installation-events";
import { db } from "@/lib/db";
import { pusherServer } from "@/lib/pusher";

vi.mock("@/lib/db", () => ({ db: { sourceControlOrg: { findUnique: vi.fn() } } }));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: { GITHUB_INSTALLATION_UPDATED: "github-installation-updated" },
}));

describe("isInstallationChange", () => {
  it("accepts repository changes and access-changing installation actions", () => {
    expect(isInstallationChange("installation_repositories", { action: "added" })).toBe(true);
    expect(isInstallationChange("installation", { action: "new_permissions_accepted" })).toBe(true);
    expect(isInstallationChange("installation", { action: "suspend" })).toBe(true);
  });

  it("ignores everything else", () => {
    expect(isInstallationChange("push", { action: "added" })).toBe(false);
    expect(isInstallationChange("installation", { action: "unknown" })).toBe(false);
    expect(isInstallationChange(null, {})).toBe(false);
  });
});

describe("notifyInstallationChange", () => {
  beforeEach(() => vi.clearAllMocks());

  it("notifies every live workspace linked to the installation", async () => {
    vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
      githubLogin: "tomsmith8",
      workspaces: [{ slug: "peel" }, { slug: "other" }],
    } as never);
    vi.mocked(pusherServer.trigger).mockResolvedValue({} as never);

    const notified = await notifyInstallationChange("installation_repositories", {
      action: "added",
      installation: { id: 42 },
      repositories_added: [{ full_name: "tomsmith8/peel" }],
    });

    expect(notified).toBe(2);
    expect(db.sourceControlOrg.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { githubInstallationId: 42 } }),
    );
    expect(pusherServer.trigger).toHaveBeenCalledWith("workspace-peel", "github-installation-updated", {
      event: "installation_repositories",
      action: "added",
      repositoriesAdded: ["tomsmith8/peel"],
      repositoriesRemoved: [],
    });
    expect(pusherServer.trigger).toHaveBeenCalledWith("workspace-other", "github-installation-updated", expect.anything());
  });

  it("does nothing for an installation Hive doesn't know", async () => {
    vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue(null);

    expect(await notifyInstallationChange("installation", { action: "created", installation: { id: 1 } })).toBe(0);
    expect(pusherServer.trigger).not.toHaveBeenCalled();
  });

  it("does not fail when a Pusher trigger fails", async () => {
    vi.mocked(db.sourceControlOrg.findUnique).mockResolvedValue({
      githubLogin: "o",
      workspaces: [{ slug: "w" }],
    } as never);
    vi.mocked(pusherServer.trigger).mockRejectedValue(new Error("pusher down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      notifyInstallationChange("installation", { action: "new_permissions_accepted", installation: { id: 5 } }),
    ).resolves.toBe(1);
  });
});
