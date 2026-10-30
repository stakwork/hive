/**
 * Strut device pairing end to end (`lib/strut-devices.ts`,
 * `services/strut-device-peers.ts`, `/api/strut-devices/*`): a device starts
 * a pairing, the person approves it, the device's poll collects its
 * credential and one peer record per org the person belongs to — each with
 * a `lab:peer` token for the person (`sub` = their strut actor), signed with
 * that org's central swarm's key — then renews with the credential until the
 * device is revoked. No swarm is asked anything: `fetch` throws.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { POST as START } from "@/app/api/strut-devices/pair/route";
import { POST as POLL } from "@/app/api/strut-devices/pair/token/route";
import { GET as LOOKUP, POST as DECIDE } from "@/app/api/strut-devices/pair/approve/route";
import { GET as PEERS } from "@/app/api/strut-devices/peers/route";
import { GET as LIST } from "@/app/api/strut-devices/route";
import { DELETE as REVOKE } from "@/app/api/strut-devices/[deviceId]/route";
import {
  createAuthenticatedDeleteRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createPostRequest, createRequestWithHeaders } from "@/__tests__/support/helpers/request-builders";
import { createTestRepository, createTestSwarm, createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { hashApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";

let installationIdCounter = 940000;
const BASE = "http://localhost:3000/api/strut-devices";

async function createOrg(name: string) {
  const githubLogin = `${name}-${generateUniqueId()}`;
  return db.sourceControlOrg.create({
    data: { githubLogin, githubInstallationId: installationIdCounter++, type: "ORG", name: `${name} Org` },
  });
}

/** A workspace in the org with a swarm `https://<host>/api` keyed `<host>-key`; the org's default when asked. */
async function orgWorkspace(orgId: string, ownerId: string, host: string, opts: { isDefault?: boolean } = {}) {
  const ws = await createTestWorkspace({ ownerId, sourceControlOrgId: orgId, slug: `${host}-${generateUniqueId()}`.slice(0, 40) });
  await createTestSwarm({ workspaceId: ws.id, name: `${host}-${generateUniqueId()}`, swarmUrl: `https://${host}.sphinx.chat/api`, swarmApiKey: `${host}-key`, status: "ACTIVE" });
  if (opts.isDefault) await db.sourceControlOrg.update({ where: { id: orgId }, data: { defaultWorkspaceId: ws.id } });
  return ws;
}

const session = (user: { id: string; email: string | null; name: string | null }) => ({
  id: user.id,
  email: user.email ?? "",
  name: user.name ?? "",
});

/** Pairing and renewal reach no swarm: a request to one fails the test. */
const mockFetch = vi.fn(async (url: string) => {
  throw new Error(`unexpected fetch ${url}`);
});

/**
 * A peer token as the swarm's mcp checks it (stakgraph `verifyApiToken`):
 * an HS256 JWT under the swarm's API key, `lab:peer` with the person's
 * `sub`, good for a week.
 */
function expectPersonToken(token: string, swarmKey: string, actor: string) {
  const payload = jwt.verify(token, swarmKey, { algorithms: ["HS256"] }) as jwt.JwtPayload;
  expect(payload).toMatchObject({ scope: "lab:peer", sub: actor });
  expect(payload.exp! - payload.iat!).toBe(7 * 24 * 3600);
  expect(() => jwt.verify(token, "another-swarm-key")).toThrow();
}

async function startPairing(name = "Evan's MacBook") {
  const res = await START(createPostRequest(`${BASE}/pair`, { name }));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  };
}

const poll = (deviceCode: string) => POLL(createPostRequest(`${BASE}/pair/token`, { deviceCode }));

const decide = (user: Parameters<typeof session>[0], code: string, action: "approve" | "deny") =>
  DECIDE(createAuthenticatedPostRequest(`${BASE}/pair/approve`, session(user), { code, action }));

const renew = (credential: string) =>
  PEERS(createRequestWithHeaders(`${BASE}/peers`, "GET", { Authorization: `Bearer ${credential}` }));

describe("strut device pairing", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
  });

  test("pair, collect the credential and one person-scoped peer per org, renew, revoke", async () => {
    const alice = await createTestUser({ name: "Alice", withGitHubAuth: true, githubUsername: "alice" });
    const actor = `alice-${alice.id}`;
    // Org A: alice owns its default workspace and a second one, each with a repo.
    const orgA = await createOrg("acme");
    const homeA = await orgWorkspace(orgA.id, alice.id, "acme-central", { isDefault: true });
    const spokeA = await orgWorkspace(orgA.id, alice.id, "acme-spoke");
    await createTestRepository({ workspaceId: homeA.id, repositoryUrl: "https://github.com/acme/hive" });
    await createTestRepository({ workspaceId: spokeA.id, repositoryUrl: "https://github.com/acme/web" });
    // Org B: alice is a member of its default workspace.
    const bob = await createTestUser({ name: "Bob", withGitHubAuth: true, githubUsername: "bob" });
    const orgB = await createOrg("globex");
    const homeB = await orgWorkspace(orgB.id, bob.id, "globex-central", { isDefault: true });
    await db.workspaceMember.create({ data: { workspaceId: homeB.id, userId: alice.id, role: "DEVELOPER" } });
    // Org C: alice is in no workspace of it — never connected.
    const orgC = await createOrg("initech");
    await orgWorkspace(orgC.id, bob.id, "initech-central", { isDefault: true });

    // 1. The device asks for a code.
    const started = await startPairing();
    expect(started.userCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(started.verificationUri).toBe("http://localhost:3000/pair");
    expect(started.verificationUriComplete).toBe(`http://localhost:3000/pair?code=${started.userCode}`);
    expect(started).toMatchObject({ expiresIn: 600, interval: 5 });
    const row = await db.strutDevicePairing.findUniqueOrThrow({ where: { userCode: started.userCode } });
    expect(row.deviceCodeHash).toBe(hashApiKey(started.deviceCode));
    expect(JSON.stringify(row)).not.toContain(started.deviceCode);

    // 2. Not approved yet.
    const pending = await poll(started.deviceCode);
    expect(pending.status).toBe(400);
    expect(await pending.json()).toEqual({ error: "authorization_pending" });

    // 3. The person looks it up — typed in lower case without the dash — and sees their orgs only.
    const lookup = await LOOKUP(
      createAuthenticatedGetRequest(`${BASE}/pair/approve`, alice, { code: started.userCode.replace("-", "").toLowerCase() }),
    );
    expect(lookup.status).toBe(200);
    const looked = await lookup.json();
    expect(looked.pairing).toMatchObject({ userCode: started.userCode, deviceName: "Evan's MacBook", status: "pending", decidedByYou: false });
    expect(looked.orgs.map((o: { githubLogin: string }) => o.githubLogin).sort()).toEqual([orgA.githubLogin, orgB.githubLogin].sort());

    // 4. Approved.
    const approved = await decide(alice, started.userCode, "approve");
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ status: "approved" });
    expect((await decide(alice, started.userCode, "deny")).status).toBe(409);

    // 5. The poll collects the credential and the peers.
    const collected = await poll(started.deviceCode);
    expect(collected.status).toBe(200);
    const paired = await collected.json();
    expect(paired.credential).toMatch(/^hivedev_[0-9A-Za-z]{32}$/);
    expect(paired.device).toEqual({ id: expect.any(String), name: "Evan's MacBook" });
    expect(paired.actor).toBe(actor);
    expect(paired.errors).toEqual([]);
    expect(Date.parse(paired.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);
    const byId = Object.fromEntries(paired.peers.map((p: { id: string }) => [p.id, p]));
    expect(Object.keys(byId).sort()).toEqual([homeA.slug, homeB.slug].sort());
    expect(byId[homeA.slug]).toEqual({
      id: homeA.slug,
      baseUrl: "https://acme-central.sphinx.chat:3355/lab",
      token: expect.any(String),
      label: "acme Org",
      description: `Workspaces: ${homeA.slug}, ${spokeA.slug}.`,
      repos: ["https://github.com/acme/hive", "https://github.com/acme/web"],
    });
    expect(byId[homeB.slug]).toMatchObject({ baseUrl: "https://globex-central.sphinx.chat:3355/lab", label: "globex Org" });
    expect(byId[homeB.slug]).not.toHaveProperty("repos");
    // Each token is signed with that org's central swarm's own key, for alice, for a week — no swarm asked.
    expectPersonToken(byId[homeA.slug].token, "acme-central-key", actor);
    expectPersonToken(byId[homeB.slug].token, "globex-central-key", actor);
    expect(mockFetch).not.toHaveBeenCalled();

    // 6. The code is spent: the credential is handed out once.
    expect(await (await poll(started.deviceCode)).json()).toEqual({ error: "expired_token" });
    const device = await db.strutDevice.findUniqueOrThrow({ where: { id: paired.device.id } });
    expect(device).toMatchObject({ userId: alice.id, credentialHash: hashApiKey(paired.credential), revokedAt: null });

    // 7. Renewal: fresh tokens, the person's orgs as they are NOW.
    await db.workspaceMember.updateMany({ where: { workspaceId: homeB.id, userId: alice.id }, data: { leftAt: new Date() } });
    mockFetch.mockClear();
    const renewed = await renew(paired.credential);
    expect(renewed.status).toBe(200);
    const fresh = await renewed.json();
    expect(fresh.actor).toBe(actor);
    expect(fresh.peers.map((p: { id: string }) => p.id)).toEqual([homeA.slug]);
    expectPersonToken(fresh.peers[0].token, "acme-central-key", actor);
    expect(mockFetch).not.toHaveBeenCalled();
    expect((await db.strutDevice.findUniqueOrThrow({ where: { id: device.id } })).lastUsedAt).not.toBeNull();

    // 8. The settings list, then revoke: the renewal stops.
    const listed = await (await LIST(createAuthenticatedGetRequest(BASE, alice))).json();
    expect(listed.devices).toEqual([
      expect.objectContaining({ id: device.id, name: "Evan's MacBook", credentialPrefix: paired.credential.slice(0, 12) }),
    ]);
    expect(JSON.stringify(listed)).not.toContain(paired.credential);
    // Not bob's to revoke.
    expect((await REVOKE(createAuthenticatedDeleteRequest(`${BASE}/${device.id}`, session(bob)), { params: Promise.resolve({ deviceId: device.id }) })).status).toBe(404);
    const revoked = await REVOKE(createAuthenticatedDeleteRequest(`${BASE}/${device.id}`, session(alice)), {
      params: Promise.resolve({ deviceId: device.id }),
    });
    expect(revoked.status).toBe(200);
    expect((await renew(paired.credential)).status).toBe(401);
    expect((await (await LIST(createAuthenticatedGetRequest(BASE, alice))).json()).devices).toEqual([]);
  });

  test("a denied pairing is access_denied; an unknown credential is 401", async () => {
    const carol = await createTestUser({ name: "Carol" });
    const started = await startPairing();
    expect(await (await decide(carol, started.userCode, "deny")).json()).toEqual({ status: "denied" });
    const res = await poll(started.deviceCode);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "access_denied" });
    expect((await renew("hivedev_nope")).status).toBe(401);
    expect((await renew("")).status).toBe(401);
  });

  test("an expired code cannot be approved or collected, and is deleted by the next start", async () => {
    const dave = await createTestUser({ name: "Dave" });
    const started = await startPairing();
    await db.strutDevicePairing.update({ where: { userCode: started.userCode }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await decide(dave, started.userCode, "approve")).status).toBe(410);
    expect(await (await poll(started.deviceCode)).json()).toEqual({ error: "expired_token" });
    expect((await decide(dave, "BCDF-GHJK-X", "approve")).status).toBe(404);
    await startPairing();
    expect(await db.strutDevicePairing.findUnique({ where: { userCode: started.userCode } })).toBeNull();
  });

  test("an org with no usable swarm gets no record — the device is still paired, the other orgs get theirs", async () => {
    const erin = await createTestUser({ name: "Erin", withGitHubAuth: true, githubUsername: "erin" });
    const actor = `erin-${erin.id}`;
    const broken = await createOrg("nourl");
    const brokenHome = await createTestWorkspace({ ownerId: erin.id, sourceControlOrgId: broken.id, slug: `nourl-${generateUniqueId()}`.slice(0, 40) });
    await createTestSwarm({ workspaceId: brokenHome.id, name: `nourl-${generateUniqueId()}`, swarmUrl: "", swarmApiKey: "nourl-key", status: "ACTIVE" });
    const fine = await createOrg("fine");
    const fineHome = await orgWorkspace(fine.id, erin.id, "fine-central", { isDefault: true });
    const started = await startPairing("Laptop");
    await decide(erin, started.userCode, "approve");
    const paired = await (await poll(started.deviceCode)).json();
    expect(paired.credential).toMatch(/^hivedev_/);
    expect(paired.peers.map((p: { id: string }) => p.id)).toEqual([fineHome.slug]);
    expectPersonToken(paired.peers[0].token, "fine-central-key", actor);
    expect(paired.errors).toEqual([{ org: broken.githubLogin, error: "The workspace has no swarm configured, so it has no strut." }]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
