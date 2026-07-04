import { describe, test, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/mock/stakwork/prompt_daily_runs/route";
import { mockPromptDailyRunsStore } from "@/app/api/mock/stakwork/prompt_daily_runs/store";

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/mock/stakwork/prompt_daily_runs");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new NextRequest(url.toString());
}

describe("GET /api/mock/stakwork/prompt_daily_runs", () => {
  describe("response envelope shape", () => {
    test("returns correct envelope with success, total, size, prompt_daily_runs", async () => {
      const res = await GET(makeRequest({ run_date: "2024-01-15" }));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toBeDefined();
      expect(typeof body.data.total).toBe("number");
      expect(typeof body.data.size).toBe("number");
      expect(Array.isArray(body.data.prompt_daily_runs)).toBe(true);
    });

    test("each row has all required fields", async () => {
      const res = await GET(makeRequest({ run_date: "2024-01-15" }));
      const { data } = await res.json();

      for (const row of data.prompt_daily_runs) {
        expect(row).toHaveProperty("id");
        expect(row).toHaveProperty("prompt_id");
        expect(row).toHaveProperty("prompt_version_id");
        expect(row).toHaveProperty("workflow_id");
        expect(row).toHaveProperty("customer_id");
        expect(row).toHaveProperty("run_date");
        expect(row).toHaveProperty("run_count");
        expect(row).toHaveProperty("hive_version_id");
        expect(row).toHaveProperty("created_at");
        expect(row).toHaveProperty("updated_at");
      }
    });
  });

  describe("filtering by run_date", () => {
    test("returns only rows matching run_date", async () => {
      const res = await GET(makeRequest({ run_date: "2024-01-15" }));
      const { data } = await res.json();

      expect(data.prompt_daily_runs.length).toBeGreaterThan(0);
      for (const row of data.prompt_daily_runs) {
        expect(row.run_date).toBe("2024-01-15");
      }
    });

    test("returns different rows for a different run_date", async () => {
      const res = await GET(makeRequest({ run_date: "2024-01-16" }));
      const { data } = await res.json();

      expect(data.prompt_daily_runs.length).toBeGreaterThan(0);
      for (const row of data.prompt_daily_runs) {
        expect(row.run_date).toBe("2024-01-16");
      }
    });

    test("returns empty prompt_daily_runs for a date with no rows", async () => {
      const res = await GET(makeRequest({ run_date: "1999-01-01" }));
      const { data } = await res.json();

      expect(data.total).toBe(0);
      expect(data.size).toBe(0);
      expect(data.prompt_daily_runs).toHaveLength(0);
    });

    test("total reflects filtered count, not store total", async () => {
      const allRows = mockPromptDailyRunsStore.filter((r) => r.run_date === "2024-01-15");
      const res = await GET(makeRequest({ run_date: "2024-01-15" }));
      const { data } = await res.json();

      expect(data.total).toBe(allRows.length);
    });
  });

  describe("pagination", () => {
    test("page=1 returns first slice", async () => {
      const res = await GET(makeRequest({ run_date: "2024-01-15", page: "1" }));
      const { data } = await res.json();
      expect(data.size).toBe(data.prompt_daily_runs.length);
    });

    test("page beyond available rows returns empty prompt_daily_runs", async () => {
      const res = await GET(makeRequest({ run_date: "2024-01-15", page: "9999" }));
      const { data } = await res.json();
      expect(data.size).toBe(0);
      expect(data.prompt_daily_runs).toHaveLength(0);
    });

    test("size equals the number of items in prompt_daily_runs", async () => {
      const res = await GET(makeRequest({ run_date: "2024-01-15" }));
      const { data } = await res.json();
      expect(data.size).toBe(data.prompt_daily_runs.length);
    });

    test("no page param defaults to page 1", async () => {
      const resPage1 = await GET(makeRequest({ run_date: "2024-01-15", page: "1" }));
      const resDefault = await GET(makeRequest({ run_date: "2024-01-15" }));

      const page1Data = (await resPage1.json()).data;
      const defaultData = (await resDefault.json()).data;

      expect(defaultData.prompt_daily_runs).toEqual(page1Data.prompt_daily_runs);
    });
  });

  describe("store contains unresolvable hive_version_id row", () => {
    test("store has at least one row with hive_version_id=unresolvable-version-id for negative testing", () => {
      const unresolvable = mockPromptDailyRunsStore.find(
        (r) => r.hive_version_id === "unresolvable-version-id"
      );
      expect(unresolvable).toBeDefined();
    });

    test("unresolvable row is still returned by the mock (sync service handles skipping)", async () => {
      const unresolvableRow = mockPromptDailyRunsStore.find(
        (r) => r.hive_version_id === "unresolvable-version-id"
      )!;
      const res = await GET(makeRequest({ run_date: unresolvableRow.run_date }));
      const { data } = await res.json();

      const found = data.prompt_daily_runs.find(
        (r: { hive_version_id: string }) => r.hive_version_id === "unresolvable-version-id"
      );
      expect(found).toBeDefined();
    });
  });
});
