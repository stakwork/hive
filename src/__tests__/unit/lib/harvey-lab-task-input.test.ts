import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchHarveyTaskInput, findHarveyTask, outputDescOf } from "@/lib/harvey-lab/task-input";

const SLUG = "banking-finance/identify-issues-in-compliance-certificate";

const taskJson = {
  title: "Identify Issues in Compliance Certificate ",
  instructions: "Review the certificate.\n\n### Output\n`memo.docx`",
  deliverables: { "compliance-certificate-issue-memo.docx": "The memo" },
  criteria: [{ id: "C-001", title: "Cap", match_criteria: "PASS if …", deliverables: ["compliance-certificate-issue-memo.docx"] }],
};

const listing = [
  { type: "file", name: "a.docx", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/a.docx" },
  { type: "dir", name: "nested", download_url: null },
  { type: "file", name: "b.xlsx", download_url: "https://raw.githubusercontent.com/stakwork/harvey-labs/main/b.xlsx" },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function mockGitHub(task: Response, docs: Response) {
  const fetchMock = vi.fn(async (url: string) => (url.includes("/task.json") ? task : docs));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("Harvey LAB task input", () => {
  it("finds catalogue tasks only", () => {
    expect(findHarveyTask(SLUG)?.slug).toBe(SLUG);
    expect(findHarveyTask("banking-finance/../../etc")).toBeNull();
    expect(findHarveyTask("")).toBeNull();
  });

  it("names the deliverables, else the instructions' Output section", () => {
    expect(outputDescOf(taskJson)).toBe("compliance-certificate-issue-memo.docx");
    expect(outputDescOf({ instructions: taskJson.instructions })).toBe("memo.docx");
    expect(outputDescOf({})).toBe("");
  });

  it("builds harvey-lab-run's input from task.json and the documents folder", async () => {
    const fetchMock = mockGitHub(json(taskJson), json(listing));
    const built = await fetchHarveyTaskInput(findHarveyTask(SLUG)!);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/${SLUG}/task.json`,
      `https://api.github.com/repos/stakwork/harvey-labs/contents/tasks/${SLUG}/documents`,
    ]);
    expect(built).toEqual({
      ok: true,
      input: {
        task_slug: SLUG,
        task_title: "Identify Issues in Compliance Certificate",
        task_goal: taskJson.instructions,
        task_output_desc: "compliance-certificate-issue-memo.docx",
        documents_json: [listing[0].download_url, listing[2].download_url],
        rubrics_json: taskJson.criteria,
      },
    });
  });

  it("treats a missing documents folder as no documents", async () => {
    mockGitHub(json(taskJson), json({ message: "Not Found" }, 404));
    const built = await fetchHarveyTaskInput(findHarveyTask(SLUG)!);
    expect(built.ok && built.input.documents_json).toEqual([]);
  });

  it("says what is missing instead of launching a task it cannot describe", async () => {
    mockGitHub(json({}, 404), json(listing));
    expect(await fetchHarveyTaskInput(findHarveyTask(SLUG)!)).toEqual({ ok: false, error: "task.json answered HTTP 404" });
    mockGitHub(json({ ...taskJson, criteria: [] }), json(listing));
    expect(await fetchHarveyTaskInput(findHarveyTask(SLUG)!)).toEqual({ ok: false, error: "task.json has no criteria" });
    mockGitHub(json(taskJson), json({ message: "rate limited" }, 403));
    expect(await fetchHarveyTaskInput(findHarveyTask(SLUG)!)).toEqual({
      ok: false,
      error: "the documents listing answered HTTP 403",
    });
  });
});
