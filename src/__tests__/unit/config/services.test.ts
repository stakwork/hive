import { describe, it, expect } from "vitest";
import { getServiceConfig, serviceConfigs } from "@/config/services";
import { ServiceConfig } from "@/types";

describe("getServiceConfig", () => {
  describe("Known services", () => {
    it("should return correct configuration for stakwork service", () => {
      const config = getServiceConfig("stakwork");
      
      expect(config).toBeDefined();
      expect(config).toMatchObject({
        baseURL: expect.any(String),
        apiKey: expect.any(String),
        timeout: expect.any(Number),
        headers: expect.any(Object),
      });
      expect(config.baseURL).toBe(
        process.env.STAKWORK_BASE_URL || "https://jobs.stakwork.com/api/v1"
      );
      expect(config.headers).toHaveProperty("Content-Type", "application/json");
      expect(config.headers).toHaveProperty("X-User-Email");
      expect(config.headers).toHaveProperty("X-User-Password");
    });

    it("should return correct configuration for poolManager service", () => {
      const config = getServiceConfig("poolManager");
      
      expect(config).toBeDefined();
      expect(config).toMatchObject({
        baseURL: expect.any(String),
        apiKey: expect.any(String),
        timeout: expect.any(Number),
        headers: expect.any(Object),
      });
      expect(config.baseURL).toBe(
        process.env.POOL_MANAGER_BASE_URL || "https://workspaces.sphinx.chat/api"
      );
      expect(config.headers).toHaveProperty("Content-Type", "application/json");
    });

    it("should return correct configuration for wizard service", () => {
      const config = getServiceConfig("wizard");
      
      expect(config).toBeDefined();
      expect(config).toMatchObject({
        baseURL: expect.any(String),
        apiKey: expect.any(String),
        timeout: expect.any(Number),
        headers: expect.any(Object),
      });
      expect(config.baseURL).toBe(process.env.NEXT_PUBLIC_API_BASE_URL || "");
      expect(config.apiKey).toBe(""); // Not needed for internal API calls
      expect(config.timeout).toBe(30000); // Longer timeout for wizard operations
      expect(config.headers).toHaveProperty("Content-Type", "application/json");
    });

    it("should return correct configuration for github service", () => {
      const config = getServiceConfig("github");
      
      expect(config).toBeDefined();
      expect(config).toMatchObject({
        baseURL: expect.any(String),
        apiKey: expect.any(String),
        timeout: expect.any(Number),
        headers: expect.any(Object),
      });
      expect(config.baseURL).toBe("https://api.github.com");
      expect(config.apiKey).toBe("");
      expect(config.headers).toHaveProperty("Accept", "application/vnd.github.v3+json");
    });

    it("should return correct configuration for swarm service", () => {
      const config = getServiceConfig("swarm");
      
      expect(config).toBeDefined();
      expect(config).toMatchObject({
        baseURL: expect.any(String),
        apiKey: expect.any(String),
        timeout: expect.any(Number),
        headers: expect.any(Object),
      });
      expect(config.baseURL).toBe(process.env.SWARM_SUPER_ADMIN_URL || "");
      expect(config.apiKey).toBe(""); // Added under x-user-token
      expect(config.timeout).toBe(120000); // 2 minutes timeout
      expect(config.headers).toHaveProperty("Content-Type", "application/json");
    });
  });

  describe("Configuration structure validation", () => {
    const knownServices = ["stakwork", "poolManager", "wizard", "github", "swarm"] as const;

    it.each(knownServices)(
      "should return ServiceConfig interface-compliant object for %s service",
      (serviceName) => {
        const config = getServiceConfig(serviceName);
        
        // Verify required properties
        expect(config).toHaveProperty("baseURL");
        expect(config).toHaveProperty("apiKey");
        expect(typeof config.baseURL).toBe("string");
        expect(typeof config.apiKey).toBe("string");
        
        // Verify optional properties if present
        if (config.timeout !== undefined) {
          expect(typeof config.timeout).toBe("number");
          expect(config.timeout).toBeGreaterThan(0);
        }
        
        if (config.headers !== undefined) {
          expect(typeof config.headers).toBe("object");
          expect(config.headers).not.toBeNull();
        }
      }
    );

    it("should return configs that match the serviceConfigs object", () => {
      const knownServices = Object.keys(serviceConfigs) as Array<keyof typeof serviceConfigs>;
      
      knownServices.forEach((serviceName) => {
        const config = getServiceConfig(serviceName);
        const expectedConfig = serviceConfigs[serviceName];
        
        expect(config).toEqual(expectedConfig);
      });
    });
  });

  describe("Unknown services", () => {
    it("should throw error for unknown service name", () => {
      const unknownService = "unknownService" as any;
      
      expect(() => getServiceConfig(unknownService)).toThrow();
    });

    it("should throw error with correct message format for unknown service", () => {
      const unknownService = "invalidService" as any;
      
      expect(() => getServiceConfig(unknownService)).toThrow(
        "Unknown service: invalidService"
      );
    });

    it("should throw Error instance for unknown service", () => {
      const unknownService = "nonExistentService" as any;
      
      expect(() => getServiceConfig(unknownService)).toThrow(Error);
    });

    it.each([
      "invalid",
      "notFound",
      "random",
      "",
      "null",
      "undefined"
    ])("should throw error for invalid service name: %s", (invalidService) => {
      expect(() => getServiceConfig(invalidService as any)).toThrow(
        `Unknown service: ${invalidService}`
      );
    });
  });

  describe("Service integration reliability", () => {
    it("should provide consistent configuration access for service integration", () => {
      // Test multiple calls return the same configuration
      const service1 = getServiceConfig("stakwork");
      const service2 = getServiceConfig("stakwork");
      
      expect(service1).toEqual(service2);
      expect(service1).toBe(service2); // Same reference
    });

    it("should handle all currently supported services without errors", () => {
      const supportedServices: Array<keyof typeof serviceConfigs> = [
        "stakwork",
        "poolManager", 
        "wizard",
        "github",
        "swarm"
      ];

      supportedServices.forEach((serviceName) => {
        expect(() => getServiceConfig(serviceName)).not.toThrow();
        
        const config = getServiceConfig(serviceName);
        expect(config).toBeDefined();
        expect(config).toHaveProperty("baseURL");
        expect(config).toHaveProperty("apiKey");
      });
    });

    it("should maintain proper error handling for service integration", () => {
      // Verify error handling works consistently
      const invalidServices = ["test1", "test2", "test3"];
      
      invalidServices.forEach((invalidService) => {
        expect(() => getServiceConfig(invalidService as any)).toThrow(Error);
        
        try {
          getServiceConfig(invalidService as any);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain("Unknown service:");
          expect((error as Error).message).toContain(invalidService);
        }
      });
    });

    it("should ensure all service configurations have required integration properties", () => {
      const services = Object.keys(serviceConfigs) as Array<keyof typeof serviceConfigs>;
      
      services.forEach((serviceName) => {
        const config = getServiceConfig(serviceName);
        
        // Critical for service integration
        expect(config.baseURL).toBeDefined();
        expect(typeof config.baseURL).toBe("string");
        
        // API key may be empty string but should be defined
        expect(config.apiKey).toBeDefined();
        expect(typeof config.apiKey).toBe("string");
        
        // Timeout should be reasonable for service calls
        if (config.timeout) {
          expect(config.timeout).toBeGreaterThan(0);
          expect(config.timeout).toBeLessThanOrEqual(300000); // Max 5 minutes
        }
        
        // Headers should be properly formatted if present
        if (config.headers) {
          expect(typeof config.headers).toBe("object");
          Object.entries(config.headers).forEach(([key, value]) => {
            expect(typeof key).toBe("string");
            expect(typeof value).toBe("string");
          });
        }
      });
    });
  });
});