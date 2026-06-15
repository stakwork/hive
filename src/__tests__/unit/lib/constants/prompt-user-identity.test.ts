import { describe, it, expect } from "vitest";
import {
  getQuickAskSystemPrompt,
  getMultiWorkspaceSystemPrompt,
  getQuickAskPrefixMessages,
  getMultiWorkspacePrefixMessages,
} from "@/lib/constants/prompt";
import type { WorkspaceConfig } from "@/lib/ai/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWs(slug: string, currentUserGithubUsername?: string): WorkspaceConfig {
  return {
    slug,
    name: `Workspace ${slug}`,
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: "key",
    repoUrls: [`https://github.com/owner/${slug}`],
    pat: "pat",
    workspaceId: `ws-${slug}`,
    userId: "user-1",
    members: [],
    currentUserGithubUsername,
  };
}

// ─── getQuickAskSystemPrompt ──────────────────────────────────────────────────

describe("getQuickAskSystemPrompt — currentUserGithubUsername", () => {
  it("includes @username mention when currentUserGithubUsername is provided", () => {
    const prompt = getQuickAskSystemPrompt(
      ["https://github.com/owner/repo"],
      undefined,
      undefined,
      "myuser",
    );
    expect(prompt).toContain("@myuser");
    expect(prompt).toContain("You are currently speaking with **@myuser**");
    expect(prompt).toContain(
      'When the user says "me", "my", or "I", they are referring to this GitHub user.',
    );
  });

  it("does not include any identity line when currentUserGithubUsername is undefined", () => {
    const prompt = getQuickAskSystemPrompt(
      ["https://github.com/owner/repo"],
      undefined,
      undefined,
      undefined,
    );
    expect(prompt).not.toContain("You are currently speaking with");
    expect(prompt).not.toContain("referring to this GitHub user");
  });

  it("does not crash or include identity line when currentUserGithubUsername is omitted", () => {
    const prompt = getQuickAskSystemPrompt(["https://github.com/owner/repo"]);
    expect(prompt).not.toContain("You are currently speaking with");
  });
});

// ─── getMultiWorkspaceSystemPrompt ───────────────────────────────────────────

describe("getMultiWorkspaceSystemPrompt — currentUserGithubUsername", () => {
  it("includes @username mention when currentUserGithubUsername is provided", () => {
    const prompt = getMultiWorkspaceSystemPrompt(
      [makeWs("alpha"), makeWs("beta")],
      "alice",
    );
    expect(prompt).toContain("@alice");
    expect(prompt).toContain("You are currently speaking with **@alice**");
    expect(prompt).toContain(
      'When the user says "me", "my", or "I", they are referring to this GitHub user.',
    );
  });

  it("does not include any identity line when currentUserGithubUsername is undefined", () => {
    const prompt = getMultiWorkspaceSystemPrompt(
      [makeWs("alpha"), makeWs("beta")],
      undefined,
    );
    expect(prompt).not.toContain("You are currently speaking with");
    expect(prompt).not.toContain("referring to this GitHub user");
  });

  it("does not crash or include identity line when second param is omitted", () => {
    const prompt = getMultiWorkspaceSystemPrompt([makeWs("alpha")]);
    expect(prompt).not.toContain("You are currently speaking with");
  });
});

// ─── getQuickAskPrefixMessages ────────────────────────────────────────────────

describe("getQuickAskPrefixMessages — threads currentUserGithubUsername to system prompt", () => {
  function getSystem(username?: string): string {
    const msgs = getQuickAskPrefixMessages(
      [],        // concepts
      [],        // repoUrls
      null,      // clueMsgs
      undefined, // description
      undefined, // members
      undefined, // orgContext
      username,
    );
    const system = msgs.find((m) => m.role === "system");
    return typeof system?.content === "string" ? system.content : "";
  }

  it("system prompt includes @username when passed", () => {
    const content = getSystem("devuser");
    expect(content).toContain("@devuser");
  });

  it("system prompt omits identity line when username is not passed", () => {
    const content = getSystem();
    expect(content).not.toContain("You are currently speaking with");
  });
});

// ─── getMultiWorkspacePrefixMessages — picks username from workspaces[0] ─────

describe("getMultiWorkspacePrefixMessages — resolves username from workspaces[0]", () => {
  function getSystem(workspaces: WorkspaceConfig[]): string {
    const msgs = getMultiWorkspacePrefixMessages(
      workspaces,
      Object.fromEntries(workspaces.map((ws) => [ws.slug, []])),
      null,
    );
    const system = msgs.find((m) => m.role === "system");
    return typeof system?.content === "string" ? system.content : "";
  }

  it("injects username from workspaces[0].currentUserGithubUsername", () => {
    const content = getSystem([
      makeWs("alpha", "bob"),
      makeWs("beta"),
    ]);
    expect(content).toContain("@bob");
    expect(content).toContain("You are currently speaking with **@bob**");
  });

  it("omits identity line when workspaces[0].currentUserGithubUsername is undefined", () => {
    const content = getSystem([makeWs("alpha"), makeWs("beta")]);
    expect(content).not.toContain("You are currently speaking with");
  });
});
