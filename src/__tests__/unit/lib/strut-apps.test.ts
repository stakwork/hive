/**
 * `lib/strut-apps.ts` — the app document link hive keys an `app` ref by,
 * and the way back from a key to which app it names: a WORKSPACE app by
 * name and version (`/apps/<name>/<vN>/files/dist/index.html`, strut
 * CALLBACKS.md §4). A job's app directory is no app any more (strut
 * plans/chained-orchestrators.md §6).
 */
import { describe, it, expect } from "vitest";
import { strutAppDocumentUrl, workspaceAppDocumentKey, workspaceAppOfKey } from "@/lib/strut-apps";

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

describe("strutAppDocumentUrl", () => {
  it("round-trips a key through the document route's address", () => {
    const at = workspaceAppOfKey("/apps/visits/v2/files/dist/index.html")!;
    expect(strutAppDocumentUrl({ githubLogin: "acme-org", swarmId: "swarm-1", ...at })).toBe(
      "/api/orgs/acme-org/strut/apps/document?swarmId=swarm-1&app=visits&version=v2",
    );
    expect(strutAppDocumentUrl({ githubLogin: "acme-org", swarmId: "swarm-1", app: "visits" })).toBe(
      "/api/orgs/acme-org/strut/apps/document?swarmId=swarm-1&app=visits",
    );
  });
});
