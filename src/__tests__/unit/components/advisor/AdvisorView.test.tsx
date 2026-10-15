// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AdvisorView } from "@/components/advisor/AdvisorView";

const EMBED_URL = "https://advisor-swarm38.sphinx.chat";
const VPN_NOTICE_SNIPPET = "only reachable on the VPN";

describe("AdvisorView", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: EMBED_URL }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows a spinner while loading, with the VPN notice visible", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<AdvisorView embedUrlEndpoint="/api/orgs/acme/advisor/embed-url" />);
    expect(document.querySelector(".animate-spin")).toBeTruthy();
    expect(screen.getByText(new RegExp(VPN_NOTICE_SNIPPET))).toBeTruthy();
  });

  it("shows the no_access message", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "nope", reason: "no_access" }),
    });
    render(<AdvisorView embedUrlEndpoint="/api/orgs/acme/advisor/embed-url" />);
    await waitFor(() => {
      expect(screen.getByText("You don't have access to the Advisor")).toBeTruthy();
    });
    expect(
      screen.getByText("Only Owners and Admins of this org's default workspace can open it."),
    ).toBeTruthy();
    expect(screen.getByText(new RegExp(VPN_NOTICE_SNIPPET))).toBeTruthy();
  });

  it("shows the not_configured message", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "nope", reason: "not_configured" }),
    });
    render(<AdvisorView embedUrlEndpoint="/api/orgs/acme/advisor/embed-url" />);
    await waitFor(() => {
      expect(screen.getByText("The Advisor isn't configured for this org.")).toBeTruthy();
    });
  });

  it("shows a generic Advisor unavailable error with the error text", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "boom" }),
    });
    render(<AdvisorView embedUrlEndpoint="/api/orgs/acme/advisor/embed-url" />);
    await waitFor(() => {
      expect(screen.getByText("Advisor unavailable")).toBeTruthy();
    });
    expect(screen.getByText("boom")).toBeTruthy();
  });

  it("renders the iframe with the exact sandbox and allow values once ready", async () => {
    render(<AdvisorView embedUrlEndpoint="/api/orgs/acme/advisor/embed-url" />);
    const iframe = (await screen.findByTitle("AWS Advisor")) as HTMLIFrameElement;
    expect(iframe.src).toBe(EMBED_URL + "/");
    expect(iframe.getAttribute("allow")).toBe("clipboard-write");
    expect(iframe.getAttribute("referrerPolicy")).toBe("no-referrer");
    expect(iframe.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads",
    );
    expect(screen.getByText(new RegExp(VPN_NOTICE_SNIPPET))).toBeTruthy();
  });

  it("rejects an endpoint that doesn't start with /api/ without fetching", async () => {
    render(<AdvisorView embedUrlEndpoint="/orgs/acme/advisor/embed-url" />);
    await waitFor(() => {
      expect(screen.getByText("Advisor unavailable")).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a protocol-relative (//) endpoint without fetching", async () => {
    render(<AdvisorView embedUrlEndpoint="//evil.test/api/orgs/acme/advisor/embed-url" />);
    await waitFor(() => {
      expect(screen.getByText("Advisor unavailable")).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
