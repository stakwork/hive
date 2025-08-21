import { describe, it, expect } from "vitest";

import * as cron from "node-cron";

function validateCronExpression(expression: string): boolean {
  return cron.validate(expression);
}

function describeCronSchedule(expression: string): string {
  if (!validateCronExpression(expression)) {
    return "Invalid cron expression";
  }

  // Common patterns
  const patterns = [
    { pattern: "0 * * * *", description: "Every hour" },
    { pattern: "0 */2 * * *", description: "Every 2 hours" },
    { pattern: "0 */6 * * *", description: "Every 6 hours" },
    { pattern: "0 */12 * * *", description: "Every 12 hours" },
    { pattern: "0 0 * * *", description: "Daily at midnight" },
    { pattern: "0 2 * * *", description: "Daily at 2:00 AM" },
    { pattern: "0 9 * * 1", description: "Every Monday at 9:00 AM" },
    { pattern: "0 0 * * 0", description: "Every Sunday at midnight" }
  ];

  const match = patterns.find(p => p.pattern === expression);
  if (match) {
    return match.description;
  }

  // Parse the expression parts
  const parts = expression.split(" ");
  if (parts.length !== 5) {
    return "Custom schedule";
  }

  const [minute, hour] = parts;
  
  if (minute === "0" && hour.startsWith("*/")) {
    const interval = hour.slice(2);
    return `Every ${interval} hours`;
  }

  return "Custom schedule";
}

describe("Janitor Cron Utilities", () => {
  describe("validateCronExpression", () => {
    it("should validate correct cron expressions", () => {
      expect(validateCronExpression("0 * * * *")).toBe(true);
      expect(validateCronExpression("0 */6 * * *")).toBe(true);
      expect(validateCronExpression("0 2 * * *")).toBe(true);
      expect(validateCronExpression("0 9 * * 1")).toBe(true);
    });

    it("should reject invalid cron expressions", () => {
      expect(validateCronExpression("")).toBe(false);
      expect(validateCronExpression("invalid")).toBe(false);
      expect(validateCronExpression("0 * * *")).toBe(false); // Missing field
      expect(validateCronExpression("60 * * * *")).toBe(false); // Invalid minute
    });
  });

  describe("describeCronSchedule", () => {
    it("should describe common cron patterns", () => {
      expect(describeCronSchedule("0 * * * *")).toBe("Every hour");
      expect(describeCronSchedule("0 */6 * * *")).toBe("Every 6 hours");
      expect(describeCronSchedule("0 */12 * * *")).toBe("Every 12 hours");
      expect(describeCronSchedule("0 2 * * *")).toBe("Daily at 2:00 AM");
      expect(describeCronSchedule("0 9 * * 1")).toBe("Every Monday at 9:00 AM");
    });

    it("should handle invalid expressions", () => {
      expect(describeCronSchedule("invalid")).toBe("Invalid cron expression");
      expect(describeCronSchedule("")).toBe("Invalid cron expression");
    });

    it("should describe custom schedules", () => {
      expect(describeCronSchedule("30 14 * * *")).toBe("Custom schedule");
      expect(describeCronSchedule("15 */4 * * *")).toBe("Custom schedule");
    });

    it("should describe interval patterns", () => {
      expect(describeCronSchedule("0 */2 * * *")).toBe("Every 2 hours");
      expect(describeCronSchedule("0 */8 * * *")).toBe("Every 8 hours");
    });
  });
});