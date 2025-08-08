import { describe, it, expect } from "vitest";
import { BaseServiceClass } from "@/lib/base-service";
import type { ServiceConfig, ApiError } from "@/types";

class TestService extends BaseServiceClass {
  public readonly serviceName = "testSvc" as const;
  constructor(cfg: ServiceConfig) { super(cfg); }

  async callThrough<T>(fn: () => Promise<T>) {
    // expose protected for testing
    // @ts-expect-error accessing protected method in test class
    return this.handleRequest(fn, "ctx");
  }
}

describe("BaseServiceClass.handleRequest", () => {
  const cfg: ServiceConfig = {
    baseURL: "https://x",
    apiKey: "k",
  };

  it("passes through successful result", async () => {
    const svc = new TestService(cfg);
    const res = await svc.callThrough(async () => 42);
    expect(res).toBe(42);
  });

  it("wraps ApiError by prefixing message and setting service", async () => {
    const svc = new TestService(cfg);
    const err: ApiError = { message: "boom", status: 400, service: "orig" };
    await expect(
      svc.callThrough(async () => {
        throw err;
      }),
    ).rejects.toMatchObject({
      status: 400,
      service: "testSvc",
      message: expect.stringContaining("testSvc ctx: boom"),
    } as Partial<ApiError>);
  });

  it("wraps unknown errors into standardized 500 ApiError", async () => {
    const svc = new TestService(cfg);
    await expect(
      svc.callThrough(async () => {
        throw new Error("weird");
      }),
    ).rejects.toMatchObject({ status: 500, service: "testSvc" });
  });
});


