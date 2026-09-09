/**
 * Unit tests for the shared HTML body proxy helpers.
 *
 * `htmlBodyProxyHeaders` must stay an opaque download (never `text/html`)
 * and must name the attachment `<slug>.html` from a sanitized stem, so a
 * slug lifted from the URL can never inject header syntax.
 */
import { describe, test, expect } from "vitest";
import {
  htmlArtifactProxyUrl,
  htmlBodyProxyHeaders,
  htmlDownloadFilename,
} from "@/lib/utils/html-body-proxy";

describe("htmlDownloadFilename", () => {
  test("appends .html to a kebab-case slug", () => {
    expect(htmlDownloadFilename("openlaw-nda-concept-tree")).toBe("openlaw-nda-concept-tree.html");
  });

  test("does not double an existing .html/.htm suffix", () => {
    expect(htmlDownloadFilename("report.html")).toBe("report.html");
    expect(htmlDownloadFilename("report.HTM")).toBe("report.html");
  });

  test("strips header-breaking and path characters", () => {
    expect(htmlDownloadFilename('a"b;c\r\nd/e\\f g')).toBe("abcdefg.html");
  });

  test("never yields a hidden file and falls back when nothing usable remains", () => {
    expect(htmlDownloadFilename("...")).toBe("page.html");
    expect(htmlDownloadFilename("")).toBe("page.html");
    expect(htmlDownloadFilename("..secret")).toBe("secret.html");
    expect(htmlDownloadFilename("\"'; ")).toBe("page.html");
  });
});

describe("htmlBodyProxyHeaders", () => {
  test("serves an opaque, non-cacheable attachment named <slug>.html", () => {
    const headers = htmlBodyProxyHeaders("my-page");
    expect(headers).toEqual({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="my-page.html"',
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Cache-Control": "private, no-store",
    });
  });

  test("Content-Type is never text/html", () => {
    expect(htmlBodyProxyHeaders("anything")["Content-Type"]).not.toMatch(/html/i);
  });

  test("a hostile stem cannot break out of the Content-Disposition value", () => {
    const disposition = htmlBodyProxyHeaders('x"; filename="evil.exe\r\nX-Injected: 1')[
      "Content-Disposition"
    ];
    expect(disposition).toBe('attachment; filename="xfilenameevil.exeX-Injected1.html"');
    expect(disposition).not.toMatch(/[\r\n]/);
    // Exactly one quoted filename parameter — no injected second one.
    expect(disposition.match(/filename=/g)).toHaveLength(1);
  });
});

describe("htmlArtifactProxyUrl", () => {
  test("builds the org html-pages proxy path with encoded segments", () => {
    expect(htmlArtifactProxyUrl({ githubLogin: "acme org", slug: "a/b" })).toBe(
      "/api/orgs/acme%20org/html-pages/a%2Fb",
    );
  });

  test("builds the task artifact proxy path with encoded segments", () => {
    expect(htmlArtifactProxyUrl({ taskId: "t 1", artifactId: "a/1" })).toBe(
      "/api/tasks/t%201/artifacts/a%2F1/html",
    );
  });
});
