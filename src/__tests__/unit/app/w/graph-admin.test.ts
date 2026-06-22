// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── postGraphAdminCmd unit tests ──────────────────────────────────────────────

async function makePostGraphAdminCmd(fetchImpl: typeof fetch) {
  vi.stubGlobal("fetch", fetchImpl);
  // Re-import to pick up fresh fetch stub
  const { postGraphAdminCmd } = await import(
    "@/app/w/[slug]/graph-admin/utils"
  );
  return postGraphAdminCmd;
}

describe("postGraphAdminCmd error surfacing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("throws swarm.message when swarm is an object with message", async () => {
    const postGraphAdminCmd = await makePostGraphAdminCmd(
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "Swarm cmd failed",
          swarm: { message: "duplicate entry" },
        }),
      }) as unknown as typeof fetch,
    );

    await expect(
      postGraphAdminCmd("test-slug", {
        type: "Swarm",
        data: { cmd: "AddBoltwallUser" as never, content: {} },
      }),
    ).rejects.toThrow("duplicate entry");
  });

  it("throws swarm string directly when swarm is a string", async () => {
    const postGraphAdminCmd = await makePostGraphAdminCmd(
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "Swarm cmd failed",
          swarm: "already exists",
        }),
      }) as unknown as typeof fetch,
    );

    await expect(
      postGraphAdminCmd("test-slug", {
        type: "Swarm",
        data: { cmd: "AddBoltwallUser" as never, content: {} },
      }),
    ).rejects.toThrow("already exists");
  });

  it("falls back to err.error when no swarm field", async () => {
    const postGraphAdminCmd = await makePostGraphAdminCmd(
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Swarm cmd failed" }),
      }) as unknown as typeof fetch,
    );

    await expect(
      postGraphAdminCmd("test-slug", {
        type: "Swarm",
        data: { cmd: "AddBoltwallUser" as never, content: {} },
      }),
    ).rejects.toThrow("Swarm cmd failed");
  });

  it("falls back to 'Request failed' when response body is empty", async () => {
    const postGraphAdminCmd = await makePostGraphAdminCmd(
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => { throw new Error("no body"); },
      }) as unknown as typeof fetch,
    );

    await expect(
      postGraphAdminCmd("test-slug", {
        type: "Swarm",
        data: { cmd: "AddBoltwallUser" as never, content: {} },
      }),
    ).rejects.toThrow("Request failed");
  });
});

// ── truncate helper & getInitials unit tests ──────────────────────────────────

describe("getInitials", () => {
  it("returns first 2 chars of name uppercased when name is present", async () => {
    const { getInitials } = await import("@/app/w/[slug]/graph-admin/utils");
    expect(getInitials("Alice", null)).toBe("AL");
  });

  it("returns first 2 chars of pubkey uppercased when no name", async () => {
    const { getInitials } = await import("@/app/w/[slug]/graph-admin/utils");
    expect(getInitials(null, "abcdef1234")).toBe("AB");
  });

  it("returns '??' when both are null", async () => {
    const { getInitials } = await import("@/app/w/[slug]/graph-admin/utils");
    expect(getInitials(null, null)).toBe("??");
  });
});
