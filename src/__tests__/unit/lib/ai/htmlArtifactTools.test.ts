/**
 * Unit tests for save_html / update_html.
 *
 * Coverage:
 *   - save_html creates a pointer-only HtmlPage row + S3 object
 *   - duplicate slug returns a structured { error }, not a throw
 *   - update_html overwrites the same s3Key (no new key)
 *   - orgId / userId come from the closure, never tool args
 *   - foreign / malformed s3Key is rejected
 *   - html_pages write tools are registered; research.writeToolNames
 *     does not include them
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const putObject = vi.fn(async () => undefined);
const generateOrgUploadPath = vi.fn(
  (orgId: string, filename: string) =>
    `orgs/${orgId}/canvas/123_${filename}`,
);
const validateFileSize = vi.fn((size: number) => size <= 10 * 1024 * 1024);
const getObject = vi.fn();
const fileExists = vi.fn(() => true);

vi.mock("@/services/s3", () => ({
  getS3Service: () => ({
    putObject,
    generateOrgUploadPath,
    validateFileSize,
    getObject,
    fileExists,
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    sourceControlOrg: { findUnique: vi.fn() },
    htmlPage: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("ai", () => ({
  tool: vi.fn((t: unknown) => t),
}));

vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/infraTools", () => ({ buildInfraTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkerTools", () => ({ buildGraphWalkerTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkDispatchTools", () => ({
  buildGraphWalkDispatchTools: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/graphWriteTools", () => ({ buildGraphWriteTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/promptTools", () => ({ buildPromptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/conceptTools", () => ({ buildConceptTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/workflowExplorerTools", () => ({
  buildWorkflowExplorerTools: vi.fn(() => ({})),
}));
vi.mock("@/lib/ai/codeChangeTools", () => ({ buildCodeChangeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/constants/prompt", () => ({
  getRoadmapCapabilitySnippet: vi.fn(() => ""),
  getPlannerCapabilitySnippet: vi.fn(() => ""),
  getWhiteboardCapabilitySnippet: vi.fn(() => ""),
  getResearchCapabilitySnippet: vi.fn(() => ""),
  getConnectionsCapabilitySnippet: vi.fn(() => ""),
  getHtmlPagesCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => ""),
  getWorkflowsCapabilitySnippet: vi.fn(() => ""),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
}));
vi.mock("@/lib/proposals/types", () => ({
  PROPOSE_FEATURE_TOOL: "propose_feature",
  PROPOSE_INITIATIVE_TOOL: "propose_initiative",
  PROPOSE_MILESTONE_TOOL: "propose_milestone",
  PROPOSE_NEW_PROMPT_TOOL: "propose_new_prompt",
  PROPOSE_PROMPT_UPDATE_TOOL: "propose_prompt_update",
  PROPOSE_NEW_CONCEPT_TOOL: "propose_new_concept",
  PROPOSE_CONCEPT_UPDATE_TOOL: "propose_concept_update",
  PROPOSE_CREATE_NODE_TOOL: "propose_create_node",
  PROPOSE_NODE_EDIT_TOOL: "propose_node_edit",
  PROPOSE_CREATE_TRIPLET_TOOL: "propose_create_triplet",
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL: "propose_create_batch_triplet",
  PROPOSE_CODE_CHANGE_TOOL: "propose_code_change",
}));
vi.mock("@/lib/ai/capabilityGates", () => ({
  isPromptsCapabilityEnabledForOrg: vi.fn(async () => false),
  isGraphWriteCapabilityEnabledForOrg: vi.fn(async () => false),
  isCodeChangeCapabilityEnabledForOrg: vi.fn(async () => false),
}));

import { db } from "@/lib/db";
import { buildHtmlArtifactTools } from "@/lib/ai/htmlArtifactTools";
import {
  CAPABILITY_REGISTRY,
  ALL_CAPABILITIES,
  composeWriteToolNames,
} from "@/lib/ai/capabilities";
import { HTML_CONTENT_TYPE } from "@/services/html-pages";

const ORG_ID = "org-1";
const USER_ID = "user-1";
const HTML = "<!DOCTYPE html><html><body>hi</body></html>";

type ExecTool = { execute: (args: unknown) => Promise<unknown> };

function tools(orgId = ORG_ID, userId = USER_ID) {
  return buildHtmlArtifactTools(orgId, userId);
}

describe("save_html / update_html", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateOrgUploadPath.mockImplementation(
      (orgId: string, filename: string) => `orgs/${orgId}/canvas/123_${filename}`,
    );
    validateFileSize.mockImplementation((size: number) => size <= 10 * 1024 * 1024);
    putObject.mockResolvedValue(undefined);
    (db.sourceControlOrg.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      githubLogin: "acme",
    });
    (db.htmlPage.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "page-1",
      slug: "team-story",
    });
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
    );
  });

  test("save_html uploads S3 object and creates a pointer-only row", async () => {
    const result = await (tools().save_html as ExecTool).execute({
      slug: "team-story",
      title: "Team Story",
      html: HTML,
      orgId: "attacker-org",
      userId: "attacker-user",
      s3Key: "orgs/other/canvas/evil.html",
    });

    expect(generateOrgUploadPath).toHaveBeenCalledWith(ORG_ID, "team-story.html");
    expect(putObject).toHaveBeenCalledWith(
      `orgs/${ORG_ID}/canvas/123_team-story.html`,
      expect.any(Buffer),
      HTML_CONTENT_TYPE,
    );
    const uploaded = putObject.mock.calls[0][1] as Buffer;
    expect(uploaded.toString("utf8")).toBe(HTML);

    expect(db.htmlPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: "team-story",
          title: "Team Story",
          s3Key: `orgs/${ORG_ID}/canvas/123_team-story.html`,
          size: Buffer.byteLength(HTML, "utf8"),
          contentType: HTML_CONTENT_TYPE,
          orgId: ORG_ID,
          createdBy: USER_ID,
        }),
      }),
    );
    const createData = (db.htmlPage.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0].data as Record<string, unknown>;
    expect(createData).not.toHaveProperty("html");
    expect(createData).not.toHaveProperty("body");
    expect(createData).not.toHaveProperty("url");

    expect(result).toEqual({
      slug: "team-story",
      id: "page-1",
      sharePath: "/org/acme/h/team-story",
    });
  });

  test("save_html duplicate slug returns structured error, does not throw", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "test",
    });
    (db.htmlPage.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);

    const result = await (tools().save_html as ExecTool).execute({
      slug: "team-story",
      title: "Team Story",
      html: HTML,
    });

    expect(result).toEqual({
      error:
        "Failed to save HTML page. The slug may already be in use; try a different one.",
    });
  });

  test("save_html refuses oversize HTML", async () => {
    validateFileSize.mockReturnValue(false);
    const result = await (tools().save_html as ExecTool).execute({
      slug: "big",
      title: "Big",
      html: HTML,
    });
    expect(putObject).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "HTML exceeds the 10MB size limit" });
  });

  test("update_html overwrites the same s3Key and updates the row", async () => {
    const existingKey = `orgs/${ORG_ID}/canvas/123_team-story.html`;
    (db.htmlPage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "page-1",
      slug: "team-story",
      s3Key: existingKey,
      orgId: ORG_ID,
    });
    (db.htmlPage.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "page-1",
    });

    const result = await (tools().update_html as ExecTool).execute({
      slug: "team-story",
      html: "<html>revised</html>",
      orgId: "attacker-org",
      s3Key: "orgs/other/canvas/evil.html",
    });

    expect(putObject).toHaveBeenCalledTimes(1);
    expect(putObject).toHaveBeenCalledWith(
      existingKey,
      expect.any(Buffer),
      HTML_CONTENT_TYPE,
    );
    expect(generateOrgUploadPath).not.toHaveBeenCalled();
    expect(db.htmlPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_slug: { orgId: ORG_ID, slug: "team-story" } },
        data: expect.objectContaining({
          size: Buffer.byteLength("<html>revised</html>", "utf8"),
          contentType: HTML_CONTENT_TYPE,
        }),
      }),
    );
    expect(result).toEqual({ slug: "team-story", status: "updated" });
  });

  test("update_html rejects a foreign s3Key on the existing row", async () => {
    (db.htmlPage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "page-1",
      slug: "team-story",
      s3Key: "orgs/other-org/canvas/stolen.html",
      orgId: ORG_ID,
    });

    const result = await (tools().update_html as ExecTool).execute({
      slug: "team-story",
      html: HTML,
    });

    expect(putObject).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "Failed to update HTML page." });
  });

  test("update_html returns structured error when slug is missing in this org", async () => {
    (db.htmlPage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await (tools().update_html as ExecTool).execute({
      slug: "missing",
      html: HTML,
    });
    expect(result).toEqual({
      error: 'No HTML page found with slug "missing".',
    });
  });
});

describe("html_pages capability registration", () => {
  test("html_pages writeToolNames are save_html and update_html", () => {
    expect(CAPABILITY_REGISTRY.html_pages.writeToolNames).toEqual([
      "save_html",
      "update_html",
    ]);
    expect(CAPABILITY_REGISTRY.html_pages.core).toBe(false);
    expect(CAPABILITY_REGISTRY.research.writeToolNames).not.toContain("save_html");
    expect(CAPABILITY_REGISTRY.research.writeToolNames).not.toContain("update_html");
  });

  test("ALL_CAPABILITIES includes html_pages; composeWriteToolNames includes the tools", () => {
    expect(ALL_CAPABILITIES).toContain("html_pages");
    const names = composeWriteToolNames(ALL_CAPABILITIES);
    expect(names.has("save_html")).toBe(true);
    expect(names.has("update_html")).toBe(true);
    expect([...composeWriteToolNames(["html_pages"])].sort()).toEqual([
      "save_html",
      "update_html",
    ]);
  });

});
