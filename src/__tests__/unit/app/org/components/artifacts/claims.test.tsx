/**
 * The claims card's viewers (`viewers/claims.tsx`; strut plans/job-claims.md
 * §7): each claim with its status, who stated it, the latest verdict and the
 * turn it is about, the screenshot through Hive's reader route (never the
 * swarm's own link), its checks' outcomes in words, the open slots first as
 * to-dos — and the panel's actions: Verify, Supports / Refutes, a new claim,
 * each through the job's claims route, the published version shown at once.
 */

import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClaimsInline, ClaimsPanel, claimsFact, locatorView, outcomeWords, verifiedOn } from "@/app/org/[githubLogin]/_components/artifacts/viewers/claims";
import { parseArtifactContent, type ArtifactContents, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({ useChatOrgLogin: () => "acme-org" }));

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const TURN_1 = "1792018000000";
const TURN_2 = "1792018615451";
const SHOT = `/jobs/${JOB}/files/shots/001.png`;

/** As the job-turn handler stores it: strut's ledger, the listing's speaker and slot merged in. */
const ledger = {
  workspace: "acme",
  swarmId: "swarm-1",
  job: JOB,
  turn: TURN_2,
  turns: { [TURN_1]: 1, [TURN_2]: 2 },
  claims: [
    {
      id: "c-page",
      text: "The settings page renders",
      status: "supported",
      speaker: "ai",
      assertedOnly: false,
      unverified: 0,
      latest: { content: "/settings reached; all 2 expectations hold", observed_at: 1792018620, mode: "observed", checkVersion: "browser/verify@v1", about: TURN_2, locator: { url: SHOT, file: "shots/001.png" } },
      checks: [{ id: "k-page", name: "browser/verify", lastVerify: { ran: true } }],
    },
    {
      id: "c-errors",
      text: "No console errors on the settings page",
      status: "refuted",
      speaker: "person",
      assertedOnly: false,
      unverified: 0,
      latest: { content: "/settings reached; 1 of 1 expectation failed: no errors 1 on the page, first console: boom", mode: "observed", about: TURN_1 },
      checks: [{ id: "k-errors", name: "browser/verify", lastVerify: { skipped: "superseded" } }],
    },
    {
      id: "c-save",
      text: "A preference saved stays saved after a reload",
      status: "unknown",
      speaker: "person",
      assertedOnly: false,
      unverified: 1,
      checks: [{ id: "k-save", name: "eyes", external: true, description: "Tick Email, save, reload.", lastVerify: { planned: "ev-1" } }],
      slots: [{ evidence: "ev-1", check: "k-save", runId: TURN_2, question: "Open the settings page, tick Email, save, reload: is it still ticked?" }],
    },
  ],
};

const content = parseArtifactContent("claims", ledger)!;
const artifact: ArtifactRef = { id: `claims-${JOB}`, kind: "claims", title: "Settings page", source: { type: "inline", content: ledger } };

const mockFetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ROUTE = `/api/orgs/acme-org/strut/jobs/${JOB}/claims`;

describe("the content", () => {
  test("parses strut's ledger shape, the latest verdict's time included, and drops a claim that is not whole", () => {
    expect(content.claims.map((c) => [c.id, c.status])).toEqual([
      ["c-page", "supported"],
      ["c-errors", "refuted"],
      ["c-save", "unknown"],
    ]);
    expect(content.claims[0].latest?.observedAt).toBe(1792018620);
    expect(content.claims[2].slots).toEqual([{ evidence: "ev-1", check: "k-save", runId: TURN_2, question: "Open the settings page, tick Email, save, reload: is it still ticked?" }]);
    const broken = parseArtifactContent("claims", { ...ledger, claims: [...ledger.claims, { id: "x", text: "no status" }] })!;
    expect(broken.claims).toHaveLength(3);
    expect(parseArtifactContent("claims", { ...ledger, swarmId: undefined })).toBeNull();
  });
});

describe("the words", () => {
  test("the fact counts what holds", () => {
    expect(claimsFact(content)).toBe("1/3 supported · 1 refuted");
    expect(claimsFact({ ...content, claims: [] })).toBeNull();
  });

  test("which turn a verdict is about", () => {
    expect(verifiedOn(content, TURN_2)).toBe("this turn (turn 2)");
    expect(verifiedOn(content, TURN_1)).toBe("turn 1");
    expect(verifiedOn(content, "1700000000000")).toBe("an earlier turn");
    expect(verifiedOn(content, undefined)).toBeNull();
  });

  test("a check's outcome: superseded and planned in words", () => {
    expect(outcomeWords({ ran: true })).toBe("ran");
    expect(outcomeWords({ planned: "ev-1" })).toBe("waiting on a person");
    expect(outcomeWords({ skipped: "superseded" })).toBe("superseded — a newer turn");
    expect(outcomeWords({ skipped: "cannot-launch", reason: "net::ERR_NAME_NOT_RESOLVED" })).toBe("couldn't run: net::ERR_NAME_NOT_RESOLVED");
    expect(outcomeWords(undefined)).toBeNull();
  });

  test("a job file is read through the reader route, an image drawn; an endpoint is a link; nothing else is anything", () => {
    expect(locatorView("acme-org", content, { url: SHOT })).toEqual({ image: `/api/orgs/acme-org/strut/artifacts?swarmId=swarm-1&key=${encodeURIComponent(SHOT)}` });
    expect(locatorView("acme-org", content, { url: `/jobs/${JOB}/files/report.json` })).toEqual({
      file: `/api/orgs/acme-org/strut/artifacts?swarmId=swarm-1&key=${encodeURIComponent(`/jobs/${JOB}/files/report.json`)}`,
      name: "report.json",
    });
    expect(locatorView("acme-org", content, { url: "https://pod-1.example.com/api/settings" })).toEqual({ link: "https://pod-1.example.com/api/settings" });
    expect(locatorView("acme-org", content, { url: "/secrets" })).toBeNull();
    expect(locatorView("acme-org", content, { url: "javascript:alert(1)" })).toBeNull();
  });
});

describe("the card", () => {
  test("a pill per claim and what waits on the person", () => {
    render(<ClaimsInline artifact={artifact} content={content} />);
    expect(screen.getByText("The settings page renders")).toBeTruthy();
    expect(screen.getByText("supported")).toBeTruthy();
    expect(screen.getByText("refuted")).toBeTruthy();
    expect(screen.getByText("1 check is waiting on you")).toBeTruthy();
  });
});

describe("the panel", () => {
  test("each claim with its status, speaker, verdict and turn; the screenshot through the reader; checks in words; the slot first as a to-do", () => {
    render(<ClaimsPanel artifact={artifact} content={content} jobId={JOB} />);
    const todo = screen.getByTestId("claims-todo");
    expect(todo.textContent).toContain("Needs a look — A preference saved stays saved after a reload");
    expect(todo.textContent).toContain("is it still ticked?");

    const claims = screen.getAllByTestId("claims-claim");
    expect(claims.map((c) => c.querySelector("span")?.textContent)).toEqual(["supported", "refuted", "unknown"]);
    expect(claims[0].textContent).toContain("by the job's agent");
    expect(claims[0].textContent).toContain("/settings reached; all 2 expectations hold");
    expect(claims[0].textContent).toContain("verified on this turn (turn 2)");
    expect(claims[1].textContent).toContain("by a person");
    expect(claims[1].textContent).toContain("verified on turn 1");

    const img = claims[0].querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`/api/orgs/acme-org/strut/artifacts?swarmId=swarm-1&key=${encodeURIComponent(SHOT)}`);
    expect(img.getAttribute("src")).not.toContain("?t=");
    expect(claims[1].querySelector("img")).toBeNull();

    expect(screen.getAllByTestId("claims-outcome").map((o) => o.textContent)).toEqual(["ran", "superseded — a newer turn", "waiting on a person"]);
  });

  test("Verify posts to the job's claims route and shows the version it published", async () => {
    const after = { ...ledger, claims: ledger.claims.map((c) => (c.id === "c-errors" ? { ...c, status: "supported", latest: { ...c.latest, about: TURN_2 } } : c)) };
    mockFetch.mockResolvedValue(json(200, { card: { source: { type: "inline", content: after } }, summary: "2 of 3 supported, 1 waiting on you" }));
    render(<ClaimsPanel artifact={artifact} content={content} jobId={JOB} />);

    fireEvent.click(screen.getByTestId("claims-verify"));
    const note = await screen.findByTestId("claims-note");
    expect(note.textContent).toBe("Verified: 2 of 3 supported, 1 waiting on you.");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(ROUTE);
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(init.body)).toEqual({ action: "verify" });
    await waitFor(() => expect(screen.getAllByTestId("claims-claim").map((c) => c.querySelector("span")?.textContent)).toEqual(["supported", "supported", "unknown"]));
  });

  test("Supports answers the open slot on its own turn; a refutation with a note goes to the job as its next turn", async () => {
    mockFetch.mockResolvedValueOnce(json(200, { card: null }));
    render(<ClaimsPanel artifact={artifact} content={content} jobId={JOB} />);
    fireEvent.click(screen.getByText("Supports"));
    await screen.findByTestId("claims-note");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ action: "answer", claimId: "c-save", slot: "ev-1", runId: TURN_2, supports: true, note: "" });

    mockFetch.mockResolvedValueOnce(json(202, { runId: "row-9" }));
    fireEvent.change(screen.getByPlaceholderText(/What did you see/), { target: { value: "It unticks itself after the reload." } });
    fireEvent.click(screen.getByText("Refutes"));
    await waitFor(() => expect(screen.getByTestId("claims-note").textContent).toBe("Sent to the job as its next turn."));
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ action: "answer", claimId: "c-save", slot: "ev-1", runId: TURN_2, supports: false, note: "It unticks itself after the reload." });
  });

  test("a new claim is the person's acceptance criterion, with what to look at", async () => {
    mockFetch.mockResolvedValue(json(200, { card: null }));
    render(<ClaimsPanel artifact={artifact} content={content} jobId={JOB} />);
    const add = screen.getByText("Add claim") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/What must the work deliver/), { target: { value: "The page works on a phone" } });
    fireEvent.change(screen.getByPlaceholderText(/What to look at/), { target: { value: "Open it at 375 px wide." } });
    fireEvent.click(add);
    await screen.findByTestId("claims-note");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ action: "claim", text: "The page works on a phone", description: "Open it at 375 px wide." });
  });

  test("a refusal says why — only the job's owner acts on its claims", async () => {
    mockFetch.mockResolvedValue(json(403, { error: "Only the person who started a job can act on its claims" }));
    render(<ClaimsPanel artifact={artifact} content={content} jobId={JOB} />);
    fireEvent.click(screen.getByTestId("claims-verify"));
    expect(await screen.findByText("Only the person who started a job can act on its claims")).toBeTruthy();
  });
});
