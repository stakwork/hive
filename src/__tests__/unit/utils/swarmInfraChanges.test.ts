import { describe, it, expect } from "vitest";
import { hasInfrastructureChange } from "@/utils/swarmInfraChanges";

describe("hasInfrastructureChange", () => {
  describe("First save scenarios", () => {
    it("returns true when existing is null (first save)", () => {
      const incoming = {
        services: [{ name: "app", port: 3000 }],
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, null, [], []);

      expect(result).toBe(true);
    });
  });

  describe("Metadata-only changes (should NOT trigger sync)", () => {
    it("returns false when only description changed", () => {
      const incoming = {
        // No infrastructure fields included
      };
      const existing = {
        services: [{ name: "app" }],
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(false);
    });

    it("returns false when only name changed", () => {
      const incoming = {
        // No infrastructure fields included
      };
      const existing = {
        services: [{ name: "app" }],
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(false);
    });

    it("returns false when no fields changed (identical payload)", () => {
      const services = [{ name: "app", port: 3000 }];
      const incoming = {
        services,
        poolCpu: "1",
        poolMemory: "2Gi",
      };
      const existing = {
        services,
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const repos = [{ repositoryUrl: "https://github.com/org/repo" }];
      const result = hasInfrastructureChange(incoming, existing, repos, repos);

      expect(result).toBe(false);
    });

    it("returns false when all triggering fields are undefined in incoming", () => {
      const incoming = {
        // All infrastructure fields omitted
      };
      const existing = {
        services: [{ name: "app" }],
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const repos = [{ repositoryUrl: "https://github.com/org/repo" }];
      const result = hasInfrastructureChange(incoming, existing, repos, repos);

      expect(result).toBe(false);
    });
  });

  describe("Services changes", () => {
    it("returns true when services array changed", () => {
      const incoming = {
        services: [{ name: "app", port: 3001 }],
      };
      const existing = {
        services: [{ name: "app", port: 3000 }],
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });

    it("returns true when services changed from JSON string format", () => {
      const incoming = {
        services: [{ name: "api", port: 4000 }],
      };
      const existing = {
        services: JSON.stringify([{ name: "app", port: 3000 }]),
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });

    it("returns false when services are functionally identical (JSON vs object)", () => {
      const servicesArray = [{ name: "app", port: 3000 }];
      const incoming = {
        services: servicesArray,
      };
      const existing = {
        services: JSON.stringify(servicesArray),
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(false);
    });
  });

  describe("ContainerFiles (pm2.config.js) changes", () => {
    it("returns true when pm2.config.js changed", () => {
      const incoming = {
        containerFiles: { "pm2.config.js": "base64_new_content" },
      };
      const existing = {
        containerFiles: { "pm2.config.js": "base64_old_content" },
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });

    it("returns false when pm2.config.js unchanged", () => {
      const pm2Content = "base64_content";
      const incoming = {
        containerFiles: { "pm2.config.js": pm2Content },
      };
      const existing = {
        containerFiles: { "pm2.config.js": pm2Content },
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(false);
    });

    it("returns true when pm2.config.js added for first time", () => {
      const incoming = {
        containerFiles: { "pm2.config.js": "base64_content" },
      };
      const existing = {
        containerFiles: {},
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });
  });

  describe("Environment variables changes", () => {
    it("returns true when environmentVariables name/value changed", () => {
      const incoming = {
        environmentVariables: [
          { name: "NODE_ENV", value: "production" },
          { name: "PORT", value: "3001" },
        ],
      };
      const existing = {
        environmentVariables: [
          { name: "NODE_ENV", value: "development" },
          { name: "PORT", value: "3000" },
        ],
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });

    it("returns false when environmentVariables unchanged (different order)", () => {
      const incoming = {
        environmentVariables: [
          { name: "PORT", value: "3000" },
          { name: "NODE_ENV", value: "production" },
        ],
      };
      const existing = {
        environmentVariables: [
          { name: "NODE_ENV", value: "production" },
          { name: "PORT", value: "3000" },
        ],
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(false);
    });

    it("returns true when environmentVariables added", () => {
      const incoming = {
        environmentVariables: [{ name: "NEW_VAR", value: "value" }],
      };
      const existing = {
        environmentVariables: [],
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });

    it("handles environmentVariables as JSON string in existing", () => {
      const envVars = [{ name: "NODE_ENV", value: "production" }];
      const incoming = {
        environmentVariables: envVars,
      };
      const existing = {
        environmentVariables: JSON.stringify(envVars),
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(false);
    });

    it("handles null environmentVariables in existing", () => {
      const incoming = {
        environmentVariables: [{ name: "NODE_ENV", value: "production" }],
      };
      const existing = {
        environmentVariables: null,
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });
  });

  describe("Pool CPU changes", () => {
    it("returns true when poolCpu changed", () => {
      const incoming = {
        poolCpu: "2",
      };
      const existing = {
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });

    it("returns false when poolCpu unchanged", () => {
      const incoming = {
        poolCpu: "1",
      };
      const existing = {
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(false);
    });

    it("handles null poolCpu in existing", () => {
      const incoming = {
        poolCpu: "1",
      };
      const existing = {
        poolCpu: null,
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });
  });

  describe("Pool Memory changes", () => {
    it("returns true when poolMemory changed", () => {
      const incoming = {
        poolMemory: "4Gi",
      };
      const existing = {
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });

    it("returns false when poolMemory unchanged", () => {
      const incoming = {
        poolMemory: "2Gi",
      };
      const existing = {
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(false);
    });

    it("handles null poolMemory in existing", () => {
      const incoming = {
        poolMemory: "2Gi",
      };
      const existing = {
        poolCpu: "1",
        poolMemory: null,
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });
  });

  describe("Repository list changes", () => {
    it("returns true when repo added (count increases)", () => {
      const incoming = {
        repositories: [
          { repositoryUrl: "https://github.com/org/repo1" },
          { repositoryUrl: "https://github.com/org/repo2" },
        ],
      };
      const existing = {
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const incomingRepos = [
        { repositoryUrl: "https://github.com/org/repo1" },
        { repositoryUrl: "https://github.com/org/repo2" },
      ];
      const existingRepos = [{ repositoryUrl: "https://github.com/org/repo1" }];

      const result = hasInfrastructureChange(
        incoming,
        existing,
        incomingRepos,
        existingRepos,
      );

      expect(result).toBe(true);
    });

    it("returns true when repo removed (count decreases)", () => {
      const incoming = {
        repositories: [{ repositoryUrl: "https://github.com/org/repo1" }],
      };
      const existing = {
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const incomingRepos = [{ repositoryUrl: "https://github.com/org/repo1" }];
      const existingRepos = [
        { repositoryUrl: "https://github.com/org/repo1" },
        { repositoryUrl: "https://github.com/org/repo2" },
      ];

      const result = hasInfrastructureChange(
        incoming,
        existing,
        incomingRepos,
        existingRepos,
      );

      expect(result).toBe(true);
    });

    it("returns true when repo URL swapped (same count, different URL)", () => {
      const incoming = {
        repositories: [{ repositoryUrl: "https://github.com/org/repo2" }],
      };
      const existing = {
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const incomingRepos = [{ repositoryUrl: "https://github.com/org/repo2" }];
      const existingRepos = [{ repositoryUrl: "https://github.com/org/repo1" }];

      const result = hasInfrastructureChange(
        incoming,
        existing,
        incomingRepos,
        existingRepos,
      );

      expect(result).toBe(true);
    });

    it("returns false when repo list unchanged", () => {
      const incoming = {};
      const existing = {
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const repos = [{ repositoryUrl: "https://github.com/org/repo1" }];

      const result = hasInfrastructureChange(incoming, existing, repos, repos);

      expect(result).toBe(false);
    });

    it("returns false when repo list unchanged (different order)", () => {
      const incoming = {};
      const existing = {
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const incomingRepos = [
        { repositoryUrl: "https://github.com/org/repo2" },
        { repositoryUrl: "https://github.com/org/repo1" },
      ];
      const existingRepos = [
        { repositoryUrl: "https://github.com/org/repo1" },
        { repositoryUrl: "https://github.com/org/repo2" },
      ];

      const result = hasInfrastructureChange(
        incoming,
        existing,
        incomingRepos,
        existingRepos,
      );

      expect(result).toBe(false);
    });
  });

  describe("Combined changes", () => {
    it("returns true when multiple infrastructure fields changed", () => {
      const incoming = {
        services: [{ name: "app", port: 3001 }],
        poolCpu: "2",
        poolMemory: "4Gi",
        environmentVariables: [{ name: "NODE_ENV", value: "production" }],
      };
      const existing = {
        services: [{ name: "app", port: 3000 }],
        poolCpu: "1",
        poolMemory: "2Gi",
        environmentVariables: [{ name: "NODE_ENV", value: "development" }],
      };

      const result = hasInfrastructureChange(incoming, existing, [], []);

      expect(result).toBe(true);
    });

    it("returns false when only metadata present and no infra fields in incoming", () => {
      const incoming = {
        // Only metadata fields would be present in the actual request
        // (description, name, etc. are not passed to this function)
      };
      const existing = {
        services: [{ name: "app" }],
        poolCpu: "1",
        poolMemory: "2Gi",
      };

      const repos = [{ repositoryUrl: "https://github.com/org/repo" }];
      const result = hasInfrastructureChange(incoming, existing, repos, repos);

      expect(result).toBe(false);
    });
  });
});
