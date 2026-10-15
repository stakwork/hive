/**
 * Integration: a PUT /api/workspaces/[slug]/stakgraph that sends only the global env list
 * reaches the pool.
 *
 * Env vars reach a pod through pm2.config.js. The real route and the real
 * syncPoolManagerSettings run here; only PoolManagerService is mocked, to capture what
 * updatePoolData is handed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { encryptEnvVars, EncryptionService } from "@/lib/encryption";
import { maskEnvValue } from "@/lib/env-mask";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";

const updatePoolData = vi.hoisted(() => vi.fn());
vi.mock("@/services/pool-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/pool-manager")>()),
  PoolManagerService: vi.fn().mockImplementation(() => ({
    getPoolEnvVars: vi.fn().mockResolvedValue([]),
    updatePoolData,
  })),
}));

import { GET, PUT } from "@/app/api/workspaces/[slug]/stakgraph/route";

const encryption = EncryptionService.getInstance();
const toBase64 = (s: string) => Buffer.from(s).toString("base64");
const fromBase64 = (s: string) => Buffer.from(s, "base64").toString("utf-8");

/** Each app's env in a pm2.config.js by app name, read the way pm2 reads the file: by running it. */
function pm2Env(content: string): Record<string, Record<string, string>> {
  const module = { exports: {} as { apps: Array<{ name: string; env: Record<string, string> }> } };
  new Function("module", content)(module);
  return Object.fromEntries(module.exports.apps.map((app) => [app.name, app.env]));
}

const SERVICES = [
  { name: "frontend", port: 3000, scripts: { start: "npm start" } },
  { name: "worker", port: 0, scripts: { start: "node worker.js" } },
];

const GLOBALS = [
  { name: "API_URL", value: "http://localhost:3000" },
  { name: "OLD_FLAG", value: "on" },
  { name: "SECRET_KEY", value: "s3cr3t-value" },
];

// The stored file as the last push left it: the globals in every app, frontend's own env, and
// the worker's PORT "0", which only the file holds (a port-0 service gets no PORT from `services`).
const STORED_PM2 = `module.exports = {
  apps: [
    {
      name: "frontend",
      script: "npm start",
      cwd: "/workspaces/acme",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        API_URL: "http://localhost:3000",
        OLD_FLAG: "on",
        SECRET_KEY: "s3cr3t-value",
        SERVICE_TOKEN: "svc-token-value",
        PORT: "3000"
      }
    },
    {
      name: "worker",
      script: "node worker.js",
      cwd: "/workspaces/acme",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        API_URL: "http://localhost:3000",
        OLD_FLAG: "on",
        SECRET_KEY: "s3cr3t-value",
        PORT: "0"
      }
    }
  ],
};
`;

const tokenRequest = (method: "GET" | "PUT", slug: string, body?: object) =>
  new NextRequest(`http://localhost:3000/api/workspaces/${slug}/stakgraph`, {
    method,
    headers: { "Content-Type": "application/json", "x-api-token": process.env.API_TOKEN! },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe("PUT /api/workspaces/[slug]/stakgraph — global env vars alone", () => {
  let slug: string;
  let swarmId: string;

  beforeEach(async () => {
    updatePoolData.mockReset();
    updatePoolData.mockResolvedValue(undefined);

    const user = await db.user.create({
      data: { id: generateUniqueId("user"), email: `${generateUniqueId("user")}@example.com`, name: "Owner" },
    });
    const workspace = await db.workspace.create({
      data: { name: "Env Push Workspace", slug: generateUniqueSlug("env-push"), ownerId: user.id },
    });
    await db.repository.create({
      data: { workspaceId: workspace.id, repositoryUrl: "https://github.com/testorg/acme", branch: "main", name: "acme" },
    });
    const swarm = await db.swarm.create({
      data: {
        workspaceId: workspace.id,
        name: generateUniqueId("swarm"),
        status: "ACTIVE",
        swarmUrl: "https://test.sphinx.chat",
        poolName: "env-push-pool",
        poolCpu: "2",
        poolMemory: "8Gi",
        poolApiKey: JSON.stringify(encryption.encryptField("poolApiKey", "test-pool-key")),
        environmentVariables: encryptEnvVars(GLOBALS) as never,
        services: SERVICES,
        containerFiles: { "pm2.config.js": toBase64(STORED_PM2) },
      },
    });
    // The EnvironmentVariable table as a save writes it: the globals (serviceName "") and frontend's own.
    const rows = (serviceName: string, vars: Array<{ name: string; value: string }>) =>
      encryptEnvVars(vars).map((v) => ({ swarmId: swarm.id, serviceName, name: v.name, value: JSON.stringify(v.value) }));
    await db.environmentVariable.createMany({
      data: [...rows("", GLOBALS), ...rows("frontend", [{ name: "SERVICE_TOKEN", value: "svc-token-value" }])],
    });

    slug = workspace.slug;
    swarmId = swarm.id;
  });

  it("changes and removes a global in the stored and the pushed pm2.config.js; masked values keep the stored ones", async () => {
    // Read the list as a token caller sees it (masked), change one value, drop one, send it back.
    const read = await (await GET(tokenRequest("GET", slug), { params: Promise.resolve({ slug }) })).json();
    const env = read.data.environmentVariables as Array<{ name: string; value: string }>;
    expect(env.find((v) => v.name === "SECRET_KEY")?.value).toBe(maskEnvValue("s3cr3t-value"));
    const environmentVariables = env
      .filter((v) => v.name !== "OLD_FLAG")
      .map((v) => (v.name === "API_URL" ? { ...v, value: "http://localhost:4000" } : v));

    const res = await PUT(tokenRequest("PUT", slug, { environmentVariables }), { params: Promise.resolve({ slug }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      infraChanged: true,
      changeId: expect.any(String),
      rollout: { state: "rolling", error: null },
    });

    expect(updatePoolData).toHaveBeenCalledTimes(1);
    const [, , pushedEnvVars, , files] = updatePoolData.mock.calls[0];
    const pushed: string = files.pm2_config_js.content;
    const stored = await db.swarm.findUnique({ where: { id: swarmId }, select: { containerFiles: true } });
    expect(fromBase64((stored!.containerFiles as Record<string, string>)["pm2.config.js"])).toBe(pushed);

    expect(pm2Env(pushed)).toEqual({
      frontend: {
        API_URL: "http://localhost:4000",
        SECRET_KEY: "s3cr3t-value",
        SERVICE_TOKEN: "svc-token-value",
        PORT: "3000",
      },
      worker: { API_URL: "http://localhost:4000", SECRET_KEY: "s3cr3t-value", PORT: "0" },
    });
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    expect([...pushedEnvVars].sort(byName)).toEqual([
      { name: "API_URL", value: "http://localhost:4000" },
      { name: "SECRET_KEY", value: "s3cr3t-value" },
    ]);
  });
});
