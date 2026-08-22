// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMultiDocEditor } from "@/lib/docx-editor/use-multi-doc-editor";

// ─── Mock the docx engine ─────────────────────────────────────────────────────

// parseDocx is called by openDocumentFromFile internally; mock it so
// tests don't need real OOXML fixtures.
vi.mock("@/lib/docx-engine", () => ({
  parseDocx: vi.fn(async (file: File) => ({
    id: "doc-1",
    filename: file.name,
    blocks: [],
    comments: [],
    styles: new Map(),
    numbering: { abstractDefs: new Map(), numDefs: new Map() },
    sectionProperties: {},
    imageUrls: new Map(),
  })),
  exportDocx: vi.fn(),
  createDocx: vi.fn(),
}));

// ─── openDocumentFromUrl tests ───────────────────────────────────────────────

describe("useMultiDocEditor — openDocumentFromUrl", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("success path with explicit filename — opens doc with correct filename", async () => {
    const fakeBlob = new Blob(["fake docx content"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(fakeBlob, {
        status: 200,
        headers: { "Content-Type": fakeBlob.type },
      })
    );

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useMultiDocEditor({ slug: "ws-1", onError })
    );

    await act(async () => {
      await result.current.openDocumentFromUrl(
        "/api/w/ws-1/doc-proxy?url=https%3A%2F%2Fraw.githubusercontent.com%2Fstakwork%2Fharvey-labs%2Fmain%2Fdoc.docx",
        "contract.docx"
      );
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/w/ws-1/doc-proxy?url=https%3A%2F%2Fraw.githubusercontent.com%2Fstakwork%2Fharvey-labs%2Fmain%2Fdoc.docx"
    );

    expect(result.current.docs).toHaveLength(1);
    expect(result.current.docs[0].doc.filename).toBe("contract.docx");
    expect(onError).not.toHaveBeenCalled();
  });

  test("success path without explicit filename — derives filename from URL", async () => {
    const fakeBlob = new Blob(["fake docx"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(fakeBlob, { status: 200 })
    );

    const { result } = renderHook(() => useMultiDocEditor({}));

    await act(async () => {
      // No explicit filename — hook should derive from URL or use default
      await result.current.openDocumentFromUrl(
        "/api/w/ws-1/doc-proxy?url=https%3A%2F%2Fexample.com%2Fdocument.docx"
      );
    });

    expect(result.current.docs).toHaveLength(1);
    // Filename is derived (not empty)
    expect(result.current.docs[0].doc.filename).toBeTruthy();
  });

  test("error path — non-2xx response → reportError called, no doc opened", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 403, statusText: "Forbidden" })
    );

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useMultiDocEditor({ slug: "ws-1", onError })
    );

    await act(async () => {
      await result.current.openDocumentFromUrl(
        "/api/w/ws-1/doc-proxy?url=https%3A%2F%2Fexample.com%2Fsecret.docx",
        "secret.docx"
      );
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toContain("inaccessible");
    expect(result.current.docs).toHaveLength(0);
  });

  test("error path — network failure → reportError called, no doc opened", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useMultiDocEditor({ slug: "ws-1", onError })
    );

    await act(async () => {
      await result.current.openDocumentFromUrl(
        "/api/w/ws-1/doc-proxy?url=https%3A%2F%2Fexample.com%2Fdoc.docx"
      );
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toContain("inaccessible");
    expect(result.current.docs).toHaveLength(0);
  });
});

// ─── openDocumentFromS3Key tests ─────────────────────────────────────────────

describe("useMultiDocEditor — openDocumentFromS3Key", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("success path with explicit filename — calls openDocumentFromFile with correct File name", async () => {
    // Arrange: fetch returns a 200 blob
    const fakeBlob = new Blob(["fake docx content"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(fakeBlob, {
        status: 200,
        headers: { "Content-Type": fakeBlob.type },
      })
    );

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useMultiDocEditor({ slug: "ws-1", onError })
    );

    // Act
    await act(async () => {
      await result.current.openDocumentFromS3Key(
        "uploads/ws/abc/report.docx",
        "my-report.docx"
      );
    });

    // Assert: fetch called with the presigned URL endpoint
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/upload/presigned-url?s3Key=uploads%2Fws%2Fabc%2Freport.docx"
    );

    // Assert: a doc was opened with the supplied filename
    expect(result.current.docs).toHaveLength(1);
    expect(result.current.docs[0].doc.filename).toBe("my-report.docx");

    // No error reported
    expect(onError).not.toHaveBeenCalled();
  });

  test("success path without filename — derives name from s3Key tail", async () => {
    const fakeBlob = new Blob(["fake docx"], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(fakeBlob, { status: 200 })
    );

    const { result } = renderHook(() => useMultiDocEditor({}));

    await act(async () => {
      await result.current.openDocumentFromS3Key(
        "uploads/ws/tenant-1/ts_rand_report.docx"
        // no filename param
      );
    });

    expect(result.current.docs).toHaveLength(1);
    // Filename should be derived from the s3Key tail
    expect(result.current.docs[0].doc.filename).toBe("ts_rand_report.docx");
  });

  test("error path — fetch returns 404 → reportError called, no doc opened", async () => {
    // Arrange: fetch returns a 404 (auth-denied / IDOR case)
    fetchSpy.mockResolvedValueOnce(
      new Response(null, { status: 404, statusText: "Not Found" })
    );

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useMultiDocEditor({ slug: "ws-1", onError })
    );

    await act(async () => {
      await result.current.openDocumentFromS3Key(
        "uploads/ws/abc/secret.docx",
        "secret.docx"
      );
    });

    // onError must have been called with a message containing the status
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatch(/404/);

    // No document should have been opened
    expect(result.current.docs).toHaveLength(0);
  });

  test("error path — network failure → reportError called, no doc opened", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useMultiDocEditor({ slug: "ws-1", onError })
    );

    await act(async () => {
      await result.current.openDocumentFromS3Key("uploads/ws/abc/doc.docx");
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatch(/Failed to fetch/);
    expect(result.current.docs).toHaveLength(0);
  });
});
