import { describe, test, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/mock/stakwork/prompts/[id]/route";
import { POST } from "@/app/api/mock/stakwork/prompts/[id]/versions/[versionId]/publish/route";

describe("Mock prompt GET — published_version_id field", () => {
  test("prompt 1 has published_version_id: 2 and current_version_id: 3 (unpublished state)", async () => {
    const req = new NextRequest("http://localhost/api/mock/stakwork/prompts/1");
    const res = await GET(req, { params: Promise.resolve({ id: "1" }) });
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.data.current_version_id).toBe(3);
    expect(data.data.published_version_id).toBe(2);
  });

  test("prompt 2 has published_version_id === current_version_id (published state)", async () => {
    const req = new NextRequest("http://localhost/api/mock/stakwork/prompts/2");
    const res = await GET(req, { params: Promise.resolve({ id: "2" }) });
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.data.current_version_id).toBe(5);
    expect(data.data.published_version_id).toBe(5);
  });

  test("prompt 3 has published_version_id === current_version_id (published state)", async () => {
    const req = new NextRequest("http://localhost/api/mock/stakwork/prompts/3");
    const res = await GET(req, { params: Promise.resolve({ id: "3" }) });
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.data.current_version_id).toBe(2);
    expect(data.data.published_version_id).toBe(2);
  });
});

describe("Mock prompt PUT — published_version_id unchanged on save", () => {
  test("saving a prompt increments current_version_id but leaves published_version_id unchanged", async () => {
    // Use a GET first to see initial state
    const getReq = new NextRequest("http://localhost/api/mock/stakwork/prompts/1");
    const getRes = await GET(getReq, { params: Promise.resolve({ id: "1" }) });
    const initialData = (await getRes.json()).data;
    const initialPublishedVersionId = initialData.published_version_id;
    const initialCurrentVersionId = initialData.current_version_id;

    // Save the prompt
    const putReq = new NextRequest("http://localhost/api/mock/stakwork/prompts/1", {
      method: "PUT",
      body: JSON.stringify({ value: "Updated prompt value" }),
      headers: { "Content-Type": "application/json" },
    });
    const putRes = await PUT(putReq, { params: Promise.resolve({ id: "1" }) });
    const putData = await putRes.json();

    expect(putData.success).toBe(true);
    // current_version_id must have incremented
    expect(putData.data.current_version_id).toBe(initialCurrentVersionId + 1);
    // published_version_id must be unchanged
    expect(putData.data.published_version_id).toBe(initialPublishedVersionId);
  });
});

describe("Mock publish endpoint — updates published_version_id, not current_version_id", () => {
  test("publish returns success for a valid version", async () => {
    const req = new NextRequest(
      "http://localhost/api/mock/stakwork/prompts/1/versions/1/publish",
      { method: "POST" }
    );
    const res = await POST(req, { params: Promise.resolve({ id: "1", versionId: "1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("publish returns 404 for a version that does not belong to the prompt", async () => {
    // Version 4 belongs to prompt 2, not prompt 1
    const req = new NextRequest(
      "http://localhost/api/mock/stakwork/prompts/1/versions/4/publish",
      { method: "POST" }
    );
    const res = await POST(req, { params: Promise.resolve({ id: "1", versionId: "4" }) });
    expect(res.status).toBe(404);
  });

  test("publish returns 404 for a non-existent prompt", async () => {
    const req = new NextRequest(
      "http://localhost/api/mock/stakwork/prompts/999/versions/1/publish",
      { method: "POST" }
    );
    const res = await POST(req, { params: Promise.resolve({ id: "999", versionId: "1" }) });
    expect(res.status).toBe(404);
  });
});
