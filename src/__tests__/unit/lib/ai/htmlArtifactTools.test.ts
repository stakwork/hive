/**
 * Unit tests for save_html / update_html / get_html.
 *
 * Coverage:
 *   - save_html creates a pointer-only HtmlPage row + S3 object
 *   - duplicate slug returns a structured { error }, not a throw
 *   - update_html: full-replace mode, targeted-edits mode, both/neither
 *     rejected, mismatched edit writes nothing, compare-and-swap on a
 *     concurrent write writes nothing
 *   - get_html: happy path, over-cap refusal, cross-org/missing both
 *     return the identical not-found shape
 *   - slug format is enforced on all three tools
 *   - orgId / userId come from the closure, never tool args
 *   - foreign / malformed s3Key is rejected
 *   - html_pages write tools are registered (incl. get_html); research's
 *     writeToolNames does not include them
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/services/html-pages", () => {
  class HtmlPageSizeError extends Error {
    constructor() {
      super("HTML exceeds the 10MB size limit");
      this.name = "HtmlPageSizeError";
    }
  }
  class HtmlPageKeyError extends Error {
    constructor(message = "s3Key is not owned by this org") {
      super(message);
      this.name = "HtmlPageKeyError";
    }
  }
  return {
    HTML_CONTENT_TYPE: "text/html; charset=utf-8",
    HtmlPageSizeError,
    HtmlPageKeyError,
    isOrgOwnedS3Key: vi.fn(
      (orgId: string, s3Key: string) =>
        typeof s3Key === "string" && s3Key.startsWith(`orgs/${orgId}/`),
    ),
    putHtmlPageObject: vi.fn(),
    overwriteHtmlPageObject: vi.fn(),
    getHtmlPageBytes: vi.fn(),
    assertHtmlSize: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    sourceControlOrg: { findUnique: vi.fn() },
    htmlPage: {
      create: vi.fn(),
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
import { buildHtmlArtifactTools, GET_HTML_MAX_BYTES } from "@/lib/ai/htmlArtifactTools";
import {
  CAPABILITY_REGISTRY,
  ALL_CAPABILITIES,
  composeWriteToolNames,
} from "@/lib/ai/capabilities";
import {
  HTML_CONTENT_TYPE,
  getHtmlPageBytes,
  overwriteHtmlPageObject,
  putHtmlPageObject,
  isOrgOwnedS3Key,
  assertHtmlSize,
  HtmlPageSizeError,
} from "@/services/html-pages";

const ORG_ID = "org-1";
const USER_ID = "user-1";
const HTML = "<!DOCTYPE html><html><body>hi</body></html>";
const SLUG = "team-story";
const S3_KEY = `orgs/${ORG_ID}/canvas/123_${SLUG}.html`;
const READ_UPDATED_AT = new Date("2024-01-01T00:00:00.000Z");

type ExecTool = { execute: (args: unknown) => Promise<unknown> };
type SchemaTool = { inputSchema: { safeParse: (v: unknown) => { success: boolean } } };

function tools(orgId = ORG_ID, userId = USER_ID) {
  return buildHtmlArtifactTools(orgId, userId);
}

/** Default: transaction runs the callback against a tx whose updateMany succeeds (count 1). */
function mockCasSuccess() {
  (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: { htmlPage: { updateMany: () => Promise<{ count: number }> } }) => Promise<number>) =>
      cb({ htmlPage: { updateMany: async () => ({ count: 1 }) } }),
  );
}

/** Simulate a concurrent write racing the CAS: updateMany matches zero rows. */
function mockCasConflict() {
  (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: { htmlPage: { updateMany: () => Promise<{ count: number }> } }) => Promise<number>) =>
      cb({ htmlPage: { updateMany: async () => ({ count: 0 }) } }),
  );
}

function mockExistingPage(overrides: Partial<{
  slug: string;
  s3Key: string;
  updatedAt: Date;
  bytes: string;
}> = {}) {
  const page = {
    id: "page-1",
    slug: overrides.slug ?? SLUG,
    title: "Team Story",
    s3Key: overrides.s3Key ?? S3_KEY,
    size: 100,
    contentType: HTML_CONTENT_TYPE,
    uploadedAt: new Date(),
    orgId: ORG_ID,
    createdBy: USER_ID,
    updatedAt: overrides.updatedAt ?? READ_UPDATED_AT,
  };
  (getHtmlPageBytes as ReturnType<typeof vi.fn>).mockResolvedValue({
    page,
    bytes: Buffer.from(overrides.bytes ?? HTML, "utf8"),
  });
  return page;
}

describe("save_html", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isOrgOwnedS3Key as ReturnType<typeof vi.fn>).mockImplementation(
      (orgId: string, s3Key: string) => s3Key.startsWith(`orgs/${orgId}/`),
    );
    (putHtmlPageObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      s3Key: S3_KEY,
      size: Buffer.byteLength(HTML, "utf8"),
    });
    (db.sourceControlOrg.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      githubLogin: "acme",
    });
    (db.htmlPage.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "page-1",
      slug: SLUG,
    });
  });

  test("uploads S3 object and creates a pointer-only row", async () => {
    const result = await (tools().save_html as ExecTool).execute({
      slug: SLUG,
      title: "Team Story",
      html: HTML,
      orgId: "attacker-org",
      userId: "attacker-user",
      s3Key: "orgs/other/canvas/evil.html",
    });

    expect(putHtmlPageObject).toHaveBeenCalledWith(ORG_ID, HTML, `${SLUG}.html`);
    expect(db.htmlPage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: SLUG,
          title: "Team Story",
          s3Key: S3_KEY,
          orgId: ORG_ID,
          createdBy: USER_ID,
        }),
      }),
    );
    const createData = (db.htmlPage.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0].data as Record<string, unknown>;
    expect(createData).not.toHaveProperty("html");
    expect(createData).not.toHaveProperty("body");

    expect(result).toEqual({
      slug: SLUG,
      id: "page-1",
      sharePath: `/org/acme/h/${SLUG}`,
    });
  });

  test("duplicate slug returns structured error, does not throw", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
      code: "P2002",
      clientVersion: "test",
    });
    (db.htmlPage.create as ReturnType<typeof vi.fn>).mockRejectedValue(err);

    const result = await (tools().save_html as ExecTool).execute({
      slug: SLUG,
      title: "Team Story",
      html: HTML,
    });

    expect(result).toEqual({
      error:
        "Failed to save HTML page. The slug may already be in use; try a different one.",
    });
  });

  test("refuses oversize HTML", async () => {
    (putHtmlPageObject as ReturnType<typeof vi.fn>).mockRejectedValue(
      new HtmlPageSizeError(),
    );
    const result = await (tools().save_html as ExecTool).execute({
      slug: "big",
      title: "Big",
      html: HTML,
    });
    expect(db.htmlPage.create).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "HTML exceeds the 10MB size limit" });
  });

  test("slug schema rejects non-kebab-case and path-traversal input", () => {
    const schema = (tools().save_html as unknown as SchemaTool).inputSchema;
    expect(schema.safeParse({ slug: SLUG, title: "t", html: HTML }).success).toBe(true);
    expect(schema.safeParse({ slug: "Bad_Slug", title: "t", html: HTML }).success).toBe(false);
    expect(schema.safeParse({ slug: "../evil", title: "t", html: HTML }).success).toBe(false);
    expect(schema.safeParse({ slug: "has spaces", title: "t", html: HTML }).success).toBe(false);
    expect(schema.safeParse({ slug: "a".repeat(65), title: "t", html: HTML }).success).toBe(false);
  });
});

describe("update_html", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isOrgOwnedS3Key as ReturnType<typeof vi.fn>).mockImplementation(
      (orgId: string, s3Key: string) => s3Key.startsWith(`orgs/${orgId}/`),
    );
    (assertHtmlSize as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
    (overwriteHtmlPageObject as ReturnType<typeof vi.fn>).mockResolvedValue({
      size: Buffer.byteLength("<html>revised</html>", "utf8"),
    });
    (db.htmlPage.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      updatedAt: new Date("2024-06-01T00:00:00.000Z"),
    });
    mockCasSuccess();
  });

  test("full-replace mode overwrites the same s3Key and returns updatedAt", async () => {
    mockExistingPage();

    const result = await (tools().update_html as ExecTool).execute({
      slug: SLUG,
      html: "<html>revised</html>",
      orgId: "attacker-org",
      s3Key: "orgs/other/canvas/evil.html",
    });

    expect(overwriteHtmlPageObject).toHaveBeenCalledWith(
      ORG_ID,
      S3_KEY,
      "<html>revised</html>",
    );
    expect(result).toEqual({
      slug: SLUG,
      status: "updated",
      updatedAt: "2024-06-01T00:00:00.000Z",
    });
  });

  test("edits mode patches only the matched fragment", async () => {
    mockExistingPage({ bytes: "<body>hello</body>" });

    const result = await (tools().update_html as ExecTool).execute({
      slug: SLUG,
      edits: [{ oldStr: "hello", newStr: "goodbye" }],
    });

    expect(overwriteHtmlPageObject).toHaveBeenCalledWith(
      ORG_ID,
      S3_KEY,
      "<body>goodbye</body>",
    );
    expect(result).toMatchObject({ slug: SLUG, status: "updated" });
  });

  test("rejects when both html and edits are present", async () => {
    mockExistingPage();
    const result = await (tools().update_html as ExecTool).execute({
      slug: SLUG,
      html: HTML,
      edits: [{ oldStr: "a", newStr: "b" }],
    });
    expect(result).toEqual({
      error: "Pass either `html` (full replacement) or `edits` (targeted find/replace), not both and not neither.",
    });
    expect(overwriteHtmlPageObject).not.toHaveBeenCalled();
  });

  test("rejects when neither html nor edits are present", async () => {
    mockExistingPage();
    const result = await (tools().update_html as ExecTool).execute({ slug: SLUG });
    expect(result).toEqual({
      error: "Pass either `html` (full replacement) or `edits` (targeted find/replace), not both and not neither.",
    });
    expect(overwriteHtmlPageObject).not.toHaveBeenCalled();
  });

  test("mismatched edit fails closed: writes nothing, s3Key untouched", async () => {
    mockExistingPage({ bytes: "<body>hello</body>" });

    const result = await (tools().update_html as ExecTool).execute({
      slug: SLUG,
      edits: [{ oldStr: "nonexistent-fragment", newStr: "x" }],
    });

    expect(result).toMatchObject({
      error: expect.stringMatching(/not found in the page/i),
    });
    expect(overwriteHtmlPageObject).not.toHaveBeenCalled();
    expect(db.htmlPage.update).not.toHaveBeenCalled();
  });

  test("ambiguous edit without replaceAll fails closed", async () => {
    mockExistingPage({ bytes: "foo bar foo" });

    const result = await (tools().update_html as ExecTool).execute({
      slug: SLUG,
      edits: [{ oldStr: "foo", newStr: "baz" }],
    });

    expect(result).toMatchObject({
      error: expect.stringMatching(/matched 2 times/i),
    });
    expect(overwriteHtmlPageObject).not.toHaveBeenCalled();
  });

  test("stale updatedAt (concurrent write) aborts the CAS and writes nothing", async () => {
    mockExistingPage();
    mockCasConflict();

    const result = await (tools().update_html as ExecTool).execute({
      slug: SLUG,
      html: "<html>revised</html>",
    });

    expect(result).toMatchObject({
      error: expect.stringMatching(/updated by someone else/i),
    });
    expect(overwriteHtmlPageObject).not.toHaveBeenCalled();
  });

  test("rejects a foreign s3Key on the existing row", async () => {
    mockExistingPage({ s3Key: "orgs/other-org/canvas/stolen.html" });
    (isOrgOwnedS3Key as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await (tools().update_html as ExecTool).execute({
      slug: SLUG,
      html: HTML,
    });

    expect(overwriteHtmlPageObject).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "Failed to update HTML page." });
  });

  test("returns not-found shape when slug is missing in this org", async () => {
    (getHtmlPageBytes as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await (tools().update_html as ExecTool).execute({
      slug: "missing",
      html: HTML,
    });
    expect(result).toEqual({
      error: 'No HTML page found with slug "missing".',
    });
  });

  test("slug schema rejects non-kebab-case input", () => {
    const schema = (tools().update_html as unknown as SchemaTool).inputSchema;
    expect(schema.safeParse({ slug: "Bad Slug", html: HTML }).success).toBe(false);
    expect(schema.safeParse({ slug: "../evil", html: HTML }).success).toBe(false);
  });
});

describe("get_html", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("happy path returns body under cap", async () => {
    mockExistingPage({ bytes: "<html>ok</html>" });

    const result = await (tools().get_html as ExecTool).execute({ slug: SLUG });

    expect(result).toEqual({
      slug: SLUG,
      html: "<html>ok</html>",
      size: Buffer.byteLength("<html>ok</html>", "utf8"),
    });
  });

  test("over-cap returns actionable error, not truncated bytes", async () => {
    const big = "a".repeat(GET_HTML_MAX_BYTES + 1);
    mockExistingPage({ bytes: big });

    const result = await (tools().get_html as ExecTool).execute({ slug: SLUG });

    expect(result).toMatchObject({
      error: expect.stringMatching(/over the .* read limit/i),
    });
    expect(result).not.toHaveProperty("html");
  });

  test("cross-org and missing slug return the identical not-found shape", async () => {
    (getHtmlPageBytes as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const missing = await (tools().get_html as ExecTool).execute({ slug: "missing" });
    const crossOrg = await (tools().get_html as ExecTool).execute({ slug: "other-orgs-page" });

    expect(missing).toEqual({ error: 'No HTML page found with slug "missing".' });
    expect(crossOrg).toEqual({ error: 'No HTML page found with slug "other-orgs-page".' });
  });

  test("slug schema rejects non-kebab-case and oversize input", () => {
    const schema = (tools().get_html as unknown as SchemaTool).inputSchema;
    expect(schema.safeParse({ slug: SLUG }).success).toBe(true);
    expect(schema.safeParse({ slug: "Bad Slug" }).success).toBe(false);
    expect(schema.safeParse({ slug: "a".repeat(65) }).success).toBe(false);
  });
});

describe("logging never leaks the applyExactEdits error string", () => {
  test("mismatched-edit console.log calls carry only the fixed reason code, never the error/snippet", async () => {
    mockExistingPage({ bytes: "<body>hello world, this is a fairly long fragment to snippet</body>" });
    (assertHtmlSize as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
    mockCasSuccess();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = (await (tools().update_html as ExecTool).execute({
      slug: SLUG,
      edits: [{ oldStr: "this text does not exist in the page at all", newStr: "x" }],
    })) as { error: string };

    // The model-facing error DOES contain the snippet — that's expected and fine.
    expect(result.error).toMatch(/not found in the page/i);

    // But nothing logged to console.log may contain that error string or its
    // snippet — logs must stay pointer-only (slug + byte counts + reason code).
    for (const call of logSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("this text does not exist");
      expect(serialized).not.toContain(result.error);
    }
    // The reason code IS expected to appear in the structured log line.
    const htmlToolLog = logSpy.mock.calls.find(
      (call) => call[0] === "[htmlArtifactTools] update_html",
    );
    expect(htmlToolLog?.[1]).toMatchObject({ reason: "edit_mismatch" });

    logSpy.mockRestore();
  });

  test("ambiguous-edit console.log calls carry only the fixed reason code, never the error/snippet", async () => {
    mockExistingPage({ bytes: "foo bar foo baz foo qux" });
    mockCasSuccess();

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = (await (tools().update_html as ExecTool).execute({
      slug: SLUG,
      edits: [{ oldStr: "foo", newStr: "zzz" }],
    })) as { error: string };

    expect(result.error).toMatch(/matched \d+ times/i);

    for (const call of logSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(result.error);
    }
    const htmlToolLog = logSpy.mock.calls.find(
      (call) => call[0] === "[htmlArtifactTools] update_html",
    );
    expect(htmlToolLog?.[1]).toMatchObject({ reason: "edit_ambiguous" });

    logSpy.mockRestore();
  });
});

describe("html_pages capability registration", () => {
  test("html_pages writeToolNames include save_html, update_html, get_html", () => {
    expect(CAPABILITY_REGISTRY.html_pages.writeToolNames).toEqual([
      "save_html",
      "update_html",
      "get_html",
    ]);
    expect(CAPABILITY_REGISTRY.html_pages.core).toBe(false);
    expect(CAPABILITY_REGISTRY.research.writeToolNames).not.toContain("save_html");
    expect(CAPABILITY_REGISTRY.research.writeToolNames).not.toContain("update_html");
    expect(CAPABILITY_REGISTRY.research.writeToolNames).not.toContain("get_html");
  });

  test("ALL_CAPABILITIES includes html_pages; composeWriteToolNames includes the tools", () => {
    expect(ALL_CAPABILITIES).toContain("html_pages");
    const names = composeWriteToolNames(ALL_CAPABILITIES);
    expect(names.has("save_html")).toBe(true);
    expect(names.has("update_html")).toBe(true);
    expect(names.has("get_html")).toBe(true);
    expect([...composeWriteToolNames(["html_pages"])].sort()).toEqual([
      "get_html",
      "save_html",
      "update_html",
    ]);
  });
});
