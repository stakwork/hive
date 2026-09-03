/**
 * Mock S3 text/html fixtures. Missing objects must be checked via
 * fileExists — getFile auto-creates absent keys.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, test, expect, beforeEach } from "vitest";
import { s3MockState } from "@/lib/mock/s3-state";
import { S3MockWrapper } from "@/lib/mock/s3-wrapper";
import { htmlPageFixtureS3Key } from "@/lib/mock/html-fixtures";

describe("mock S3 HTML fixtures", () => {
  beforeEach(() => {
    s3MockState.reset();
  });

  test("storeFile with explicit text/html does not infer image/video", () => {
    const key = "orgs/org-1/canvas/page.html";
    const html = Buffer.from("<!DOCTYPE html><html></html>", "utf8");
    s3MockState.storeFile(key, html, "text/html");
    expect(s3MockState.fileExists(key)).toBe(true);
    const file = s3MockState.getFile(key);
    expect(file.contentType).toBe("text/html");
    expect(file.buffer.toString("utf8")).toBe("<!DOCTYPE html><html></html>");
  });

  test("fileExists is false for a missing object; getFile would auto-create", () => {
    const key = "orgs/org-1/canvas/missing.html";
    expect(s3MockState.fileExists(key)).toBe(false);
    const auto = s3MockState.getFile(key);
    expect(auto).toBeDefined();
    expect(s3MockState.fileExists(key)).toBe(true);
  });

  test("fileExists hydrates a matching on-disk HTML fixture into the in-memory map", () => {
    const orgId = "org-fixture-1";
    const key = htmlPageFixtureS3Key(orgId, "hive-vs-workspaces.html");
    const wrapper = new S3MockWrapper();
    expect(s3MockState.fileExists(key)).toBe(false);
    expect(wrapper.fileExists(key)).toBe(true);
    const onDisk = fs.readFileSync(
      path.join(process.cwd(), "src/lib/mock/fixtures/html/hive-vs-workspaces.html"),
    );
    expect(s3MockState.getFile(key).buffer.equals(onDisk)).toBe(true);
  });

  test("fileExists does not hydrate a non-fixture basename", () => {
    const wrapper = new S3MockWrapper();
    const key = htmlPageFixtureS3Key("org-fixture-1", "not-a-real-fixture.html");
    expect(wrapper.fileExists(key)).toBe(false);
  });

  test("S3MockWrapper.putObject stores explicit text/html and fileExists reports it", async () => {
    const wrapper = new S3MockWrapper();
    const key = "orgs/org-1/canvas/from-wrapper.html";
    await wrapper.putObject(key, Buffer.from("<p>hi</p>"), "text/html; charset=utf-8");
    expect(wrapper.fileExists(key)).toBe(true);
    expect(wrapper.fileExists("orgs/org-1/canvas/absent.html")).toBe(false);
    const buf = await wrapper.getObject(key);
    expect(buf.toString("utf8")).toBe("<p>hi</p>");
  });
});
