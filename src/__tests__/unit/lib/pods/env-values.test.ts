import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: { environmentVariable: { findMany: vi.fn() } } }));
// Decryption is identity here: what is stored is what comes back
vi.mock("@/lib/encryption", () => ({
  decryptEnvVars: (vars: Array<{ name: string; value: unknown }>) => vars,
}));

import { db } from "@/lib/db";
import { isPublicEnvName, loadAllStoredEnvValues } from "@/lib/pods/env-values";

describe("isPublicEnvName", () => {
  it("names a browser toolchain ships, and plain runtime config", () => {
    for (const name of ["NEXT_PUBLIC_API_URL", "PUBLIC_X", "VITE_X", "REACT_APP_X", "EXPO_PUBLIC_X", "NUXT_PUBLIC_X", "NODE_ENV", "PORT", "HOST", "HOSTNAME"]) {
      expect(isPublicEnvName(name), name).toBe(true);
    }
    for (const name of ["API_KEY", "DATABASE_URL", "TOKEN", "NEXTAUTH_SECRET", "PORTAL_KEY", "PUBLIC", "HOSTED_KEY"]) {
      expect(isPublicEnvName(name), name).toBe(false);
    }
  });
});

describe("loadAllStoredEnvValues", () => {
  // Block body: a function returned from a hook is run as its cleanup, and mockReset() returns the mock
  beforeEach(() => {
    vi.mocked(db.environmentVariable.findMany).mockReset();
  });

  it("collects global JSON, global table and service values, minus public names and empties", async () => {
    vi.mocked(db.environmentVariable.findMany).mockImplementation(async (args: unknown) => {
      const where = (args as { where: { serviceName: unknown } }).where;
      return (where.serviceName === ""
        ? [
            { name: "PORT", value: JSON.stringify("3000") },
            { name: "DATABASE_URL", value: JSON.stringify("postgres://u:p@h/db") },
          ]
        : [
            { serviceName: "web", name: "VITE_PUBLIC_THING", value: JSON.stringify("shownvalue") },
            { serviceName: "web", name: "TOKEN", value: JSON.stringify("tok-secret") },
            { serviceName: "web", name: "EMPTY", value: JSON.stringify("") },
          ]) as never;
    });
    const jsonField = [
      { name: "NODE_ENV", value: "production" },
      { name: "NEXT_PUBLIC_API_URL", value: "http://localhost:3000" },
      { name: "API_KEY", value: "supersecretvalue" },
    ];

    const values = await loadAllStoredEnvValues("sw", jsonField);

    expect([...values].sort()).toEqual(["postgres://u:p@h/db", "supersecretvalue", "tok-secret"]);
  });
});
