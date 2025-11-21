import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Janitor Cron Configuration", () => {
  describe("vercel.json cron configuration", () => {
    it("should have janitor cron job configured", () => {
      const vercelPath = path.join(process.cwd(), "vercel.json");
      expect(fs.existsSync(vercelPath)).toBe(true);

      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
      expect(vercelConfig.crons).toBeDefined();
      expect(Array.isArray(vercelConfig.crons)).toBe(true);

      const janitorCron = vercelConfig.crons.find(
        (cron: { path: string; schedule: string }) => cron.path === "/api/cron/janitors",
      );
      expect(janitorCron).toBeDefined();
      expect(janitorCron.schedule).toBeDefined();
      expect(typeof janitorCron.schedule).toBe("string");
    });

    it("should have a valid cron schedule format", () => {
      const vercelPath = path.join(process.cwd(), "vercel.json");
      const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
      const janitorCron = vercelConfig.crons.find(
        (cron: { path: string; schedule: string }) => cron.path === "/api/cron/janitors",
      );

      // Basic validation that it has 5 parts (minute hour day month dayofweek)
      const scheduleParts = janitorCron.schedule.split(" ");
      expect(scheduleParts).toHaveLength(5);
    });
  });
});
