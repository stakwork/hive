import { describe, it, expect } from "vitest";
import {
  JANITOR_CONFIG,
  JANITOR_ERRORS,
  PRIORITY_CONFIG,
  getEnabledFieldName,
  isJanitorEnabled,
  getEnabledJanitorTypes,
  createJanitorItem,
  getAllJanitorItems,
  createEnabledJanitorWhereConditions,
  getPriorityConfig,
  getJanitorIcon,
} from "@/lib/constants/janitor";
import { JanitorType, Priority } from "@prisma/client";

describe("constants/janitor", () => {
  describe("JANITOR_CONFIG", () => {
    it("should have configuration for all JanitorType values", () => {
      expect(JANITOR_CONFIG[JanitorType.UNIT_TESTS]).toBeDefined();
      expect(JANITOR_CONFIG[JanitorType.INTEGRATION_TESTS]).toBeDefined();
      expect(JANITOR_CONFIG[JanitorType.E2E_TESTS]).toBeDefined();
      expect(JANITOR_CONFIG[JanitorType.SECURITY_REVIEW]).toBeDefined();
    });

    it("should have name property for each config", () => {
      Object.values(JanitorType).forEach((type) => {
        expect(JANITOR_CONFIG[type].name).toBeDefined();
        expect(typeof JANITOR_CONFIG[type].name).toBe("string");
      });
    });

    it("should have description property for each config", () => {
      Object.values(JanitorType).forEach((type) => {
        expect(JANITOR_CONFIG[type].description).toBeDefined();
        expect(typeof JANITOR_CONFIG[type].description).toBe("string");
      });
    });

    it("should have icon property for each config", () => {
      Object.values(JanitorType).forEach((type) => {
        expect(JANITOR_CONFIG[type].icon).toBeDefined();
        // Icon imports in test environment may be objects rather than functions
        expect(typeof JANITOR_CONFIG[type].icon).toMatch(/^(function|object)$/);
      });
    });

    it("should have enabledField property for each config", () => {
      Object.values(JanitorType).forEach((type) => {
        expect(JANITOR_CONFIG[type].enabledField).toBeDefined();
        expect(typeof JANITOR_CONFIG[type].enabledField).toBe("string");
      });
    });
  });

  describe("JANITOR_ERRORS", () => {
    it("should have all required error messages", () => {
      expect(JANITOR_ERRORS.CONFIG_NOT_FOUND).toBe("Janitor configuration not found");
      expect(JANITOR_ERRORS.RUN_NOT_FOUND).toBe("Janitor run not found");
      expect(JANITOR_ERRORS.RUN_IN_PROGRESS).toBe("A janitor run of this type is already in progress");
      expect(JANITOR_ERRORS.JANITOR_DISABLED).toBe("This janitor type is not enabled");
      expect(JANITOR_ERRORS.RECOMMENDATION_NOT_FOUND).toBe("Recommendation not found");
      expect(JANITOR_ERRORS.RECOMMENDATION_ALREADY_PROCESSED).toBe("Recommendation has already been processed");
      expect(JANITOR_ERRORS.ASSIGNEE_NOT_MEMBER).toBe("Assignee is not a member of this workspace");
      expect(JANITOR_ERRORS.REPOSITORY_NOT_FOUND).toBe("Repository not found in this workspace");
      expect(JANITOR_ERRORS.INSUFFICIENT_PERMISSIONS).toBe("Insufficient permissions to perform this action");
      expect(JANITOR_ERRORS.WORKSPACE_NOT_FOUND).toBe("Workspace not found or access denied");
    });
  });

  describe("PRIORITY_CONFIG", () => {
    it("should have configuration for all Priority values", () => {
      expect(PRIORITY_CONFIG[Priority.LOW]).toBeDefined();
      expect(PRIORITY_CONFIG[Priority.MEDIUM]).toBeDefined();
      expect(PRIORITY_CONFIG[Priority.HIGH]).toBeDefined();
      expect(PRIORITY_CONFIG[Priority.CRITICAL]).toBeDefined();
    });

    it("should have ascending weight values", () => {
      expect(PRIORITY_CONFIG[Priority.LOW].weight).toBe(1);
      expect(PRIORITY_CONFIG[Priority.MEDIUM].weight).toBe(2);
      expect(PRIORITY_CONFIG[Priority.HIGH].weight).toBe(3);
      expect(PRIORITY_CONFIG[Priority.CRITICAL].weight).toBe(4);
    });

    it("should have label property for each priority", () => {
      Object.values(Priority).forEach((priority) => {
        expect(PRIORITY_CONFIG[priority].label).toBeDefined();
        expect(typeof PRIORITY_CONFIG[priority].label).toBe("string");
      });
    });

    it("should have color property for each priority", () => {
      Object.values(Priority).forEach((priority) => {
        expect(PRIORITY_CONFIG[priority].color).toBeDefined();
        expect(typeof PRIORITY_CONFIG[priority].color).toBe("string");
      });
    });
  });

  describe("getEnabledFieldName", () => {
    it("should return correct field name for UNIT_TESTS", () => {
      const field = getEnabledFieldName(JanitorType.UNIT_TESTS);
      expect(field).toBe("unitTestsEnabled");
    });

    it("should return correct field name for INTEGRATION_TESTS", () => {
      const field = getEnabledFieldName(JanitorType.INTEGRATION_TESTS);
      expect(field).toBe("integrationTestsEnabled");
    });

    it("should return correct field name for E2E_TESTS", () => {
      const field = getEnabledFieldName(JanitorType.E2E_TESTS);
      expect(field).toBe("e2eTestsEnabled");
    });

    it("should return correct field name for SECURITY_REVIEW", () => {
      const field = getEnabledFieldName(JanitorType.SECURITY_REVIEW);
      expect(field).toBe("securityReviewEnabled");
    });
  });

  describe("isJanitorEnabled", () => {
    it("should return true when janitor is enabled", () => {
      const config = {
        unitTestsEnabled: true,
        integrationTestsEnabled: false,
        e2eTestsEnabled: false,
        securityReviewEnabled: false,
      };

      expect(isJanitorEnabled(config, JanitorType.UNIT_TESTS)).toBe(true);
    });

    it("should return false when janitor is disabled", () => {
      const config = {
        unitTestsEnabled: false,
        integrationTestsEnabled: true,
        e2eTestsEnabled: false,
        securityReviewEnabled: false,
      };

      expect(isJanitorEnabled(config, JanitorType.UNIT_TESTS)).toBe(false);
    });

    it("should check all janitor types correctly", () => {
      const config = {
        unitTestsEnabled: true,
        integrationTestsEnabled: true,
        e2eTestsEnabled: false,
        securityReviewEnabled: false,
      };

      expect(isJanitorEnabled(config, JanitorType.UNIT_TESTS)).toBe(true);
      expect(isJanitorEnabled(config, JanitorType.INTEGRATION_TESTS)).toBe(true);
      expect(isJanitorEnabled(config, JanitorType.E2E_TESTS)).toBe(false);
      expect(isJanitorEnabled(config, JanitorType.SECURITY_REVIEW)).toBe(false);
    });
  });

  describe("getEnabledJanitorTypes", () => {
    it("should return only enabled janitor types", () => {
      const config = {
        unitTestsEnabled: true,
        integrationTestsEnabled: false,
        e2eTestsEnabled: true,
        securityReviewEnabled: false,
      };

      const enabled = getEnabledJanitorTypes(config);

      expect(enabled).toContain(JanitorType.UNIT_TESTS);
      expect(enabled).toContain(JanitorType.E2E_TESTS);
      expect(enabled).not.toContain(JanitorType.INTEGRATION_TESTS);
      expect(enabled).not.toContain(JanitorType.SECURITY_REVIEW);
    });

    it("should return empty array when all disabled", () => {
      const config = {
        unitTestsEnabled: false,
        integrationTestsEnabled: false,
        e2eTestsEnabled: false,
        securityReviewEnabled: false,
      };

      const enabled = getEnabledJanitorTypes(config);
      expect(enabled).toEqual([]);
    });

    it("should return all types when all enabled", () => {
      const config = {
        unitTestsEnabled: true,
        integrationTestsEnabled: true,
        e2eTestsEnabled: true,
        securityReviewEnabled: true,
      };

      const enabled = getEnabledJanitorTypes(config);
      expect(enabled).toHaveLength(4);
      expect(enabled).toContain(JanitorType.UNIT_TESTS);
      expect(enabled).toContain(JanitorType.INTEGRATION_TESTS);
      expect(enabled).toContain(JanitorType.E2E_TESTS);
      expect(enabled).toContain(JanitorType.SECURITY_REVIEW);
    });
  });

  describe("createJanitorItem", () => {
    it("should create complete janitor item", () => {
      const item = createJanitorItem(JanitorType.UNIT_TESTS);

      expect(item).toMatchObject({
        id: JanitorType.UNIT_TESTS,
        name: "Unit Tests",
        description: "Identify missing unit tests.",
        configKey: "unitTestsEnabled",
      });
      expect(item.icon).toBeDefined();
    });

    it("should create items for all janitor types", () => {
      Object.values(JanitorType).forEach((type) => {
        const item = createJanitorItem(type);
        expect(item.id).toBe(type);
        expect(item.name).toBeDefined();
        expect(item.description).toBeDefined();
        expect(item.configKey).toBeDefined();
        expect(item.icon).toBeDefined();
      });
    });
  });

  describe("getAllJanitorItems", () => {
    it("should return items for all janitor types except E2E_TESTS", () => {
      const items = getAllJanitorItems();

      expect(items).toHaveLength(3);
      expect(items.some((item) => item.id === JanitorType.UNIT_TESTS)).toBe(true);
      expect(items.some((item) => item.id === JanitorType.INTEGRATION_TESTS)).toBe(true);
      expect(items.some((item) => item.id === JanitorType.E2E_TESTS)).toBe(false);
      expect(items.some((item) => item.id === JanitorType.SECURITY_REVIEW)).toBe(true);
    });

    it("should return items with all required properties", () => {
      const items = getAllJanitorItems();

      items.forEach((item) => {
        expect(item.id).toBeDefined();
        expect(item.name).toBeDefined();
        expect(item.description).toBeDefined();
        expect(item.configKey).toBeDefined();
        expect(item.icon).toBeDefined();
      });
    });
  });

  describe("createEnabledJanitorWhereConditions", () => {
    it("should create OR conditions for all janitor types", () => {
      const conditions = createEnabledJanitorWhereConditions();

      expect(conditions).toHaveLength(4);
      expect(conditions).toContainEqual({ unitTestsEnabled: true });
      expect(conditions).toContainEqual({ integrationTestsEnabled: true });
      expect(conditions).toContainEqual({ e2eTestsEnabled: true });
      expect(conditions).toContainEqual({ securityReviewEnabled: true });
    });
  });

  describe("getPriorityConfig", () => {
    it("should return config for LOW priority", () => {
      const config = getPriorityConfig(Priority.LOW);

      expect(config).toMatchObject({
        label: "Low",
        color: "gray",
        weight: 1,
      });
    });

    it("should return config for all priorities", () => {
      Object.values(Priority).forEach((priority) => {
        const config = getPriorityConfig(priority);
        expect(config.label).toBeDefined();
        expect(config.color).toBeDefined();
        expect(config.weight).toBeGreaterThan(0);
      });
    });
  });

  describe("getJanitorIcon", () => {
    it("should return icon component for janitor type", () => {
      const icon = getJanitorIcon(JanitorType.UNIT_TESTS);

      expect(icon).toBeDefined();
      // Icon imports in test environment may be objects rather than functions
      expect(typeof icon).toMatch(/^(function|object)$/);
    });

    it("should return icons for all janitor types", () => {
      Object.values(JanitorType).forEach((type) => {
        const icon = getJanitorIcon(type);
        expect(icon).toBeDefined();
        // Icon imports in test environment may be objects rather than functions
        expect(typeof icon).toMatch(/^(function|object)$/);
      });
    });
  });
});