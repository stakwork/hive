import { describe, expect, it } from "vitest";
import {
  tableColumns,
  toolCallInput,
  toolCallPhase,
  toolIconKey,
  toolLabel,
} from "@/components/streaming/toolCallValue";
import type { StreamToolCall } from "@/types/streaming";

describe("toolLabel", () => {
  it("turns underscores into spaces, sentence case", () => {
    expect(toolLabel("graph_get_graph_neighbors")).toEqual({ name: "Graph get graph neighbors", scope: null });
  });

  it("splits a workspace prefix out as the scope", () => {
    expect(toolLabel("hive__list_concepts")).toEqual({ name: "List concepts", scope: "hive" });
    expect(toolLabel("my_org__search_code")).toEqual({ name: "Search code", scope: "my org" });
  });

  it("drops the developer MCP prefix", () => {
    expect(toolLabel("developer__read_file")).toEqual({ name: "Read file", scope: null });
  });
});

describe("toolIconKey", () => {
  it("reads the glyph off the words in the name, first match first", () => {
    expect(toolIconKey("graph_get_graph_neighbors")).toBe("graph");
    expect(toolIconKey("hive__search_code")).toBe("search");
    expect(toolIconKey("web_search")).toBe("web");
    expect(toolIconKey("developer__read_file")).toBe("file");
    expect(toolIconKey("list_concepts")).toBe("docs");
    expect(toolIconKey("send_to_feature_planner")).toBe("send");
    expect(toolIconKey("get_html")).toBe("web");
    expect(toolIconKey("search_logs")).toBe("search");
  });

  it("falls back to generic", () => {
    expect(toolIconKey("frobnicate")).toBe("generic");
  });
});

describe("tableColumns", () => {
  it("lists the fields of a list of flat objects, in first-seen order", () => {
    expect(
      tableColumns([
        { id: "a", type: "Service" },
        { id: "b", type: "Job", name: "cron" },
      ]),
    ).toEqual(["id", "type", "name"]);
  });

  it("declines anything a table would not suit", () => {
    expect(tableColumns([])).toBeNull();
    expect(tableColumns(["a", "b"])).toBeNull();
    expect(tableColumns([{ id: "a", tags: ["x"] }])).toBeNull();
    expect(tableColumns({ id: "a" })).toBeNull();
    const wide = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]));
    expect(tableColumns([wide])).toBeNull();
  });
});

describe("toolCallInput", () => {
  const base: StreamToolCall = { id: "1", toolName: "t", status: "output-available" };

  it("prefers the parsed input, then parses the streamed text, then keeps the text", () => {
    expect(toolCallInput({ ...base, input: { a: 1 }, inputText: "{}" })).toEqual({ a: 1 });
    expect(toolCallInput({ ...base, inputText: '{"a":1}' })).toEqual({ a: 1 });
    expect(toolCallInput({ ...base, inputText: "not json" })).toBe("not json");
    expect(toolCallInput(base)).toBeUndefined();
  });
});

describe("toolCallPhase", () => {
  const call = (status: StreamToolCall["status"]): StreamToolCall => ({ id: "1", toolName: "t", status });

  it("is complete on output, or on input when no output is expected", () => {
    expect(toolCallPhase(call("output-available"), true)).toBe("complete");
    expect(toolCallPhase(call("input-available"), true)).toBe("running");
    expect(toolCallPhase(call("input-available"), false)).toBe("complete");
    expect(toolCallPhase(call("output-error"), true)).toBe("error");
  });
});
