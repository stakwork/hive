import { describe, test, expect } from "vitest";
import { syncPM2AndServices, type StoredPM2Env } from "@/utils/stakgraphSync";
import { getPM2AppsContent, parseEnvVarsFromPM2Config } from "@/utils/devContainerUtils";
import type { ServiceConfig } from "@/services/swarm/db";

const toBase64 = (s: string) => Buffer.from(s).toString("base64");
const pm2Env = (files: Record<string, string>) =>
  Object.fromEntries(parseEnvVarsFromPM2Config(Buffer.from(files["pm2.config.js"], "base64").toString("utf-8")));

describe("syncPM2AndServices — global env vars sent alone (Case 7)", () => {
  const services: ServiceConfig[] = [
    { name: "web", port: 3000, scripts: { start: "npm start" } },
    { name: "worker", port: 0, scripts: { start: "node worker.js" } },
  ];
  const stored: StoredPM2Env = {
    services: [
      { ...services[0], env: { TOKEN: "t1" } },
      { ...services[1], env: {} },
    ],
    globalNames: ["API_URL", "GONE"],
  };
  // The file as last written: the old globals in every app, web's own env, and the worker's
  // PORT "0", which only the file holds.
  const oldFiles = {
    "pm2.config.js": toBase64(
      getPM2AppsContent(
        ["acme"],
        [stored.services[0], { ...services[1], env: { PORT: "0" } }],
        [
          { name: "API_URL", value: "old" },
          { name: "GONE", value: "x" },
        ],
      ).content,
    ),
    Dockerfile: toBase64("FROM node:20"),
  };

  test("regenerates pm2.config.js from the stored services and the new globals", () => {
    const result = syncPM2AndServices(
      services,
      oldFiles,
      undefined,
      { Dockerfile: toBase64("FROM node:22") },
      ["acme"],
      [{ name: "API_URL", value: "new" }],
      stored,
    );

    expect(pm2Env(result.containerFiles)).toEqual({
      web: { API_URL: "new", TOKEN: "t1", PORT: "3000" },
      worker: { API_URL: "new", PORT: "0" },
    });
    expect(result.containerFiles.Dockerfile).toBe(toBase64("FROM node:22"));
    expect(result.services).toBe(services);
  });

  test("with no pm2.config.js stored, leaves generating the files to the pool push", () => {
    const result = syncPM2AndServices(services, {}, undefined, undefined, ["acme"], [{ name: "API_URL", value: "new" }], stored);

    expect(result.containerFiles).toEqual({});
  });

  test("a pm2.config.js sent with the list is kept as sent (Case 3)", () => {
    const sent = toBase64(getPM2AppsContent(["acme"], stored.services, []).content);
    const result = syncPM2AndServices(
      services,
      oldFiles,
      undefined,
      { "pm2.config.js": sent },
      ["acme"],
      [{ name: "API_URL", value: "new" }],
      stored,
    );

    expect(result.containerFiles["pm2.config.js"]).toBe(sent);
  });
});
