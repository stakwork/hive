/**
 * `lib/strut-apps.ts` — the two app document links hive keys an `app` ref
 * by, and the way back from a key to which app it names: a WORKSPACE app
 * by name and version (`/apps/<name>/<vN>/files/dist/index.html`, strut
 * CALLBACKS.md §4) or a JOB's app by its directory
 * (`/jobs/<job>/files/<path>/dist/index.html`, strut plans/apps.md §6).
 */
import { describe, it, expect } from "vitest";
import {
  jobAppOfKey,
  strutAppDocumentUrl,
  strutAppOfKey,
  workspaceAppDocumentKey,
  workspaceAppOfKey,
} from "@/lib/strut-apps";

const JOB = "6f1c0d3e-1111-4222-8333-444455556666";

describe("workspaceAppDocumentKey", () => {
  it("spells the link as strut does: the name encoded whole, the version a segment; no version is hive's active-version spelling", () => {
    expect(workspaceAppDocumentKey("visits", "v2")).toBe("/apps/visits/v2/files/dist/index.html");
    expect(workspaceAppDocumentKey("acme/hvac/visits", "v3")).toBe(
      "/apps/acme%2Fhvac%2Fvisits/v3/files/dist/index.html",
    );
    expect(workspaceAppDocumentKey("visits")).toBe("/apps/visits/files/dist/index.html");
  });
});

describe("workspaceAppOfKey", () => {
  it("reads the name and version back off strut's link, decoding the name", () => {
    expect(workspaceAppOfKey("/apps/visits/v2/files/dist/index.html")).toEqual({ app: "visits", version: "v2" });
    expect(workspaceAppOfKey("/apps/acme%2Fhvac%2Fvisits/v3/files/dist/index.html")).toEqual({
      app: "acme/hvac/visits",
      version: "v3",
    });
    expect(workspaceAppOfKey("/apps/acme/hvac/visits/v3/files/dist/index.html")).toEqual({
      app: "acme/hvac/visits",
      version: "v3",
    });
  });

  it("no version segment is the active version; a vN-shaped last segment is the version, as strut would spell it", () => {
    expect(workspaceAppOfKey("/apps/visits/files/dist/index.html")).toEqual({ app: "visits" });
    expect(workspaceAppOfKey("/apps/x/v3/files/dist/index.html")).toEqual({ app: "x", version: "v3" });
  });

  it("null for a job's app, another file of the version, a name hive would not put in a URL, or a non-string", () => {
    expect(workspaceAppOfKey(`/jobs/${JOB}/files/apps/tracker/dist/index.html`)).toBeNull();
    expect(workspaceAppOfKey("/apps/visits/v2/files/dist/app.js")).toBeNull();
    expect(workspaceAppOfKey("/apps/visits/v2/files")).toBeNull();
    expect(workspaceAppOfKey("/apps/..%2Fetc/v2/files/dist/index.html")).toBeNull();
    expect(workspaceAppOfKey("/apps/bad%20name/v2/files/dist/index.html")).toBeNull();
    expect(workspaceAppOfKey("/apps/%E0%A4%A/v2/files/dist/index.html")).toBeNull();
    expect(workspaceAppOfKey(undefined)).toBeNull();
  });
});

describe("strutAppOfKey", () => {
  it("either form, without the swarm — what the loader hands the app frame", () => {
    expect(strutAppOfKey("/apps/visits/v2/files/dist/index.html")).toEqual({ app: "visits", version: "v2" });
    expect(strutAppOfKey(`/jobs/${JOB}/files/apps/tracker/dist/index.html`)).toEqual({
      job: JOB,
      path: "apps/tracker",
    });
    expect(strutAppOfKey("/jobs/peer%2Fbuild-1/files/apps/tracker/dist/index.html")).toEqual({
      job: "peer/build-1",
      path: "apps/tracker",
    });
    expect(strutAppOfKey("/artifacts/1790000000000/apps/x/dist/index.html")).toBeNull();
  });

  it("round-trips through the document route's address", () => {
    const at = strutAppOfKey("/apps/visits/v2/files/dist/index.html")!;
    expect(strutAppDocumentUrl({ githubLogin: "acme-org", swarmId: "swarm-1", ...at })).toBe(
      "/api/orgs/acme-org/strut/apps/document?swarmId=swarm-1&app=visits&version=v2",
    );
    const job = jobAppOfKey(`/jobs/${JOB}/files/apps/tracker/dist/index.html`)!;
    expect(strutAppDocumentUrl({ githubLogin: "acme-org", swarmId: "swarm-1", ...job })).toBe(
      `/api/orgs/acme-org/strut/apps/document?swarmId=swarm-1&job=${JOB}&path=apps%2Ftracker`,
    );
  });
});
