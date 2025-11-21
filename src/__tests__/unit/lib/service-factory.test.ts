import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ServiceFactory, ServiceName, stakworkService, poolManagerService, wizardService } from "@/lib/service-factory";
import { StakworkService } from "@/services/stakwork";
import { PoolManagerService } from "@/services/pool-manager";
import { WizardService } from "@/services/wizard";
import { getServiceConfig } from "@/config/services";

// Mock the service dependencies
vi.mock("@/services/stakwork");
vi.mock("@/services/pool-manager");
vi.mock("@/services/wizard");
vi.mock("@/config/services");

describe("ServiceFactory", () => {
  const mockConfig = {
    apiKey: "test-api-key",
    baseUrl: "https://test.example.com",
    headers: { "Content-Type": "application/json" },
  };

  const mockStakworkService = {
    serviceName: "stakwork",
    updateApiKey: vi.fn(),
    createProject: vi.fn(),
    createCustomer: vi.fn(),
    createSecret: vi.fn(),
    stakworkRequest: vi.fn(),
  };

  const mockPoolManagerService = {
    serviceName: "poolManager",
    updateApiKey: vi.fn(),
    createPool: vi.fn(),
    createUser: vi.fn(),
    deletePool: vi.fn(),
    getPoolEnvVars: vi.fn(),
    updatePoolData: vi.fn(),
  };

  const mockWizardService = {
    serviceName: "wizard",
    updateApiKey: vi.fn(),
    getWizardState: vi.fn(),
    updateWizardProgress: vi.fn(),
    resetWizard: vi.fn(),
    createSwarm: vi.fn(),
    pollSwarm: vi.fn(),
  };

  beforeEach(() => {
    // Clear all instances before each test
    ServiceFactory.clearInstances();

    // Reset all mocks
    vi.clearAllMocks();

    // Setup default mock implementations
    vi.mocked(getServiceConfig).mockReturnValue(mockConfig);
    vi.mocked(StakworkService).mockImplementation(() => mockStakworkService as any);
    vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManagerService as any);
    vi.mocked(WizardService).mockImplementation(() => mockWizardService as any);
  });

  afterEach(() => {
    // Clean up instances after each test
    ServiceFactory.clearInstances();
  });

  describe("getService", () => {
    it("should create and return a StakworkService instance", () => {
      const service = ServiceFactory.getService<StakworkService>("stakwork");

      expect(getServiceConfig).toHaveBeenCalledWith("stakwork");
      expect(StakworkService).toHaveBeenCalledWith(mockConfig);
      expect(service).toBe(mockStakworkService);
    });

    it("should create and return a PoolManagerService instance", () => {
      const service = ServiceFactory.getService<PoolManagerService>("poolManager");

      expect(getServiceConfig).toHaveBeenCalledWith("poolManager");
      expect(PoolManagerService).toHaveBeenCalledWith(mockConfig);
      expect(service).toBe(mockPoolManagerService);
    });

    it("should create and return a WizardService instance", () => {
      const service = ServiceFactory.getService<WizardService>("wizard");

      expect(getServiceConfig).toHaveBeenCalledWith("wizard");
      expect(WizardService).toHaveBeenCalledWith(mockConfig);
      expect(service).toBe(mockWizardService);
    });

    it("should return the same instance on subsequent calls (singleton pattern)", () => {
      const service1 = ServiceFactory.getService<StakworkService>("stakwork");
      const service2 = ServiceFactory.getService<StakworkService>("stakwork");

      expect(service1).toBe(service2);
      expect(StakworkService).toHaveBeenCalledTimes(1);
      expect(getServiceConfig).toHaveBeenCalledTimes(1);
    });

    it("should throw an error for unknown service names", () => {
      expect(() => {
        ServiceFactory.getService("unknown" as ServiceName);
      }).toThrow("Unknown service: unknown");
    });

    it("should create different instances for different service types", () => {
      const stakwork = ServiceFactory.getService<StakworkService>("stakwork");
      const poolManager = ServiceFactory.getService<PoolManagerService>("poolManager");
      const wizard = ServiceFactory.getService<WizardService>("wizard");

      expect(stakwork).toBe(mockStakworkService);
      expect(poolManager).toBe(mockPoolManagerService);
      expect(wizard).toBe(mockWizardService);
      expect(stakwork).not.toBe(poolManager);
      expect(poolManager).not.toBe(wizard);
      expect(stakwork).not.toBe(wizard);
    });
  });

  describe("getStakworkService", () => {
    it("should return a StakworkService instance", () => {
      const service = ServiceFactory.getStakworkService();

      expect(service).toBe(mockStakworkService);
      expect(StakworkService).toHaveBeenCalledWith(mockConfig);
    });

    it("should return the same instance on multiple calls", () => {
      const service1 = ServiceFactory.getStakworkService();
      const service2 = ServiceFactory.getStakworkService();

      expect(service1).toBe(service2);
      expect(StakworkService).toHaveBeenCalledTimes(1);
    });
  });

  describe("getPoolManagerService", () => {
    it("should return a PoolManagerService instance", () => {
      const service = ServiceFactory.getPoolManagerService();

      expect(service).toBe(mockPoolManagerService);
      expect(PoolManagerService).toHaveBeenCalledWith(mockConfig);
    });

    it("should return the same instance on multiple calls", () => {
      const service1 = ServiceFactory.getPoolManagerService();
      const service2 = ServiceFactory.getPoolManagerService();

      expect(service1).toBe(service2);
      expect(PoolManagerService).toHaveBeenCalledTimes(1);
    });
  });

  describe("getWizardService", () => {
    it("should return a WizardService instance", () => {
      const service = ServiceFactory.getWizardService();

      expect(service).toBe(mockWizardService);
      expect(WizardService).toHaveBeenCalledWith(mockConfig);
    });

    it("should return the same instance on multiple calls", () => {
      const service1 = ServiceFactory.getWizardService();
      const service2 = ServiceFactory.getWizardService();

      expect(service1).toBe(service2);
      expect(WizardService).toHaveBeenCalledTimes(1);
    });
  });

  describe("updateServiceApiKey", () => {
    it("should update the API key for stakwork service", () => {
      const newApiKey = "new-stakwork-key";
      ServiceFactory.updateServiceApiKey("stakwork", newApiKey);

      expect(mockStakworkService.updateApiKey).toHaveBeenCalledWith(newApiKey);
    });

    it("should update the API key for poolManager service", () => {
      const newApiKey = "new-pool-key";
      ServiceFactory.updateServiceApiKey("poolManager", newApiKey);

      expect(mockPoolManagerService.updateApiKey).toHaveBeenCalledWith(newApiKey);
    });

    it("should update the API key for wizard service", () => {
      const newApiKey = "new-wizard-key";
      ServiceFactory.updateServiceApiKey("wizard", newApiKey);

      expect(mockWizardService.updateApiKey).toHaveBeenCalledWith(newApiKey);
    });

    it("should create service instance if not already created", () => {
      const newApiKey = "new-key";
      ServiceFactory.updateServiceApiKey("stakwork", newApiKey);

      expect(StakworkService).toHaveBeenCalledWith(mockConfig);
      expect(mockStakworkService.updateApiKey).toHaveBeenCalledWith(newApiKey);
    });
  });

  describe("clearInstances", () => {
    it("should clear all service instances", () => {
      // Create some service instances
      ServiceFactory.getStakworkService();
      ServiceFactory.getPoolManagerService();
      ServiceFactory.getWizardService();

      // Clear instances
      ServiceFactory.clearInstances();

      // Verify new instances are created on next call
      ServiceFactory.getStakworkService();
      expect(StakworkService).toHaveBeenCalledTimes(2); // Once before clear, once after
    });

    it("should allow creation of new instances after clearing", () => {
      const service1 = ServiceFactory.getStakworkService();
      ServiceFactory.clearInstances();
      const service2 = ServiceFactory.getStakworkService();

      expect(service1).toBe(mockStakworkService);
      expect(service2).toBe(mockStakworkService);
      expect(StakworkService).toHaveBeenCalledTimes(2);
    });
  });

  describe("getAllServices", () => {
    it("should return all three service instances", () => {
      const services = ServiceFactory.getAllServices();

      expect(services).toEqual({
        stakwork: mockStakworkService,
        poolManager: mockPoolManagerService,
        wizard: mockWizardService,
      });
    });

    it("should create instances if they don't exist", () => {
      ServiceFactory.getAllServices();

      expect(StakworkService).toHaveBeenCalledWith(mockConfig);
      expect(PoolManagerService).toHaveBeenCalledWith(mockConfig);
      expect(WizardService).toHaveBeenCalledWith(mockConfig);
    });

    it("should return existing instances if already created", () => {
      // Pre-create one service
      ServiceFactory.getStakworkService();

      const services = ServiceFactory.getAllServices();

      expect(services.stakwork).toBe(mockStakworkService);
      expect(StakworkService).toHaveBeenCalledTimes(1); // Only called once for pre-creation
      expect(PoolManagerService).toHaveBeenCalledTimes(1); // Called once in getAllServices
      expect(WizardService).toHaveBeenCalledTimes(1); // Called once in getAllServices
    });
  });

  describe("convenience export functions", () => {
    describe("stakworkService", () => {
      it("should return a StakworkService instance", () => {
        const service = stakworkService();

        expect(service).toBe(mockStakworkService);
        expect(StakworkService).toHaveBeenCalledWith(mockConfig);
      });
    });

    describe("poolManagerService", () => {
      it("should return a PoolManagerService instance", () => {
        const service = poolManagerService();

        expect(service).toBe(mockPoolManagerService);
        expect(PoolManagerService).toHaveBeenCalledWith(mockConfig);
      });
    });

    describe("wizardService", () => {
      it("should return a WizardService instance", () => {
        const service = wizardService();

        expect(service).toBe(mockWizardService);
        expect(WizardService).toHaveBeenCalledWith(mockConfig);
      });
    });

    it("convenience functions should return the same instances as ServiceFactory methods", () => {
      expect(stakworkService()).toBe(ServiceFactory.getStakworkService());
      expect(poolManagerService()).toBe(ServiceFactory.getPoolManagerService());
      expect(wizardService()).toBe(ServiceFactory.getWizardService());
    });
  });

  describe("integration scenarios", () => {
    it("should handle mixed usage of direct methods and convenience functions", () => {
      const direct = ServiceFactory.getStakworkService();
      const convenience = stakworkService();

      expect(direct).toBe(convenience);
      expect(StakworkService).toHaveBeenCalledTimes(1);
    });

    it("should handle service configuration errors gracefully", () => {
      vi.mocked(getServiceConfig).mockImplementation(() => {
        throw new Error("Config not found");
      });

      expect(() => {
        ServiceFactory.getStakworkService();
      }).toThrow("Config not found");
    });

    it("should handle service construction errors gracefully", () => {
      vi.mocked(StakworkService).mockImplementation(() => {
        throw new Error("Service construction failed");
      });

      expect(() => {
        ServiceFactory.getStakworkService();
      }).toThrow("Service construction failed");
    });

    it("should maintain independent service instances", () => {
      const stakwork = ServiceFactory.getStakworkService();
      const poolManager = ServiceFactory.getPoolManagerService();

      ServiceFactory.updateServiceApiKey("stakwork", "stakwork-key");
      ServiceFactory.updateServiceApiKey("poolManager", "pool-key");

      expect(mockStakworkService.updateApiKey).toHaveBeenCalledWith("stakwork-key");
      expect(mockPoolManagerService.updateApiKey).toHaveBeenCalledWith("pool-key");
      expect(mockStakworkService.updateApiKey).not.toHaveBeenCalledWith("pool-key");
      expect(mockPoolManagerService.updateApiKey).not.toHaveBeenCalledWith("stakwork-key");
    });
  });
});
