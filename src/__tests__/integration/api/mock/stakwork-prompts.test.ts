import { describe, test, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/mock/stakwork/prompts/route";

describe("POST /api/mock/stakwork/prompts — name format validation", () => {
  test("returns 400 for name with lowercase letters", async () => {
    const request = new NextRequest("http://localhost/api/mock/stakwork/prompts", {
      method: "POST",
      body: JSON.stringify({ name: "invalid name", value: "some value" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Prompt name must contain only uppercase letters and underscores");
  });

  test("returns 400 for name with numbers", async () => {
    const request = new NextRequest("http://localhost/api/mock/stakwork/prompts", {
      method: "POST",
      body: JSON.stringify({ name: "PROMPT_123", value: "some value" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Prompt name must contain only uppercase letters and underscores");
  });

  test("returns 400 for name with dashes", async () => {
    const request = new NextRequest("http://localhost/api/mock/stakwork/prompts", {
      method: "POST",
      body: JSON.stringify({ name: "PROMPT-NAME", value: "some value" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Prompt name must contain only uppercase letters and underscores");
  });

  test("returns 400 when name is missing", async () => {
    const request = new NextRequest("http://localhost/api/mock/stakwork/prompts", {
      method: "POST",
      body: JSON.stringify({ value: "some value" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Prompt name must contain only uppercase letters and underscores");
  });

  test("returns 200 for valid uppercase+underscore name", async () => {
    const request = new NextRequest("http://localhost/api/mock/stakwork/prompts", {
      method: "POST",
      body: JSON.stringify({ name: "VALID_NAME", value: "some value" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.name).toBe("VALID_NAME");
  });

  test("returns 200 for name with only uppercase letters", async () => {
    const request = new NextRequest("http://localhost/api/mock/stakwork/prompts", {
      method: "POST",
      body: JSON.stringify({ name: "MYPROMPT", value: "some value" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });
});
