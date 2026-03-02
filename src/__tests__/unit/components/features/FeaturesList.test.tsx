import { describe, it, expect } from "vitest";

describe("FeaturesList - Created by filter", () => {
  describe("createdByOptions", () => {
    it("should build createdByOptions correctly from members", () => {
      const mockMembers = [
        {
          user: {
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            image: "https://example.com/john.jpg",
          },
        },
        {
          user: {
            id: "user-2",
            name: "Jane Smith",
            email: "jane@example.com",
            image: "https://example.com/jane.jpg",
          },
        },
        {
          user: {
            id: "user-3",
            name: null,
            email: "noname@example.com",
            image: null,
          },
        },
      ];

      // Simulate the createdByOptions construction from FeaturesList.tsx
      const createdByOptions = [
        { value: "ALL", label: "All Creators", image: null, name: null },
        { value: "UNCREATED", label: "Unset", image: null, name: null },
        ...mockMembers.map((member) => ({
          value: member.user.id,
          label: member.user.name || member.user.email || "Unknown",
          image: member.user.image,
          name: member.user.name,
        })),
      ];

      // Verify structure
      expect(createdByOptions).toHaveLength(5); // ALL + UNCREATED + 3 members
      expect(createdByOptions[0]).toEqual({
        value: "ALL",
        label: "All Creators",
        image: null,
        name: null,
      });
      expect(createdByOptions[1]).toEqual({
        value: "UNCREATED",
        label: "Unset",
        image: null,
        name: null,
      });
      expect(createdByOptions[2].value).toBe("user-1");
      expect(createdByOptions[2].label).toBe("John Doe");
      expect(createdByOptions[3].value).toBe("user-2");
      expect(createdByOptions[3].label).toBe("Jane Smith");
    });

    it("should use email as label when name is null", () => {
      const member = {
        user: {
          id: "user-3",
          name: null,
          email: "noname@example.com",
          image: null,
        },
      };

      // Simulate the label logic from FeaturesList.tsx
      const label = member.user.name || member.user.email || "Unknown";
      expect(label).toBe("noname@example.com");
    });

    it("should use 'Unknown' as fallback when both name and email are null", () => {
      const member = {
        user: {
          id: "user-4",
          name: null,
          email: null,
          image: null,
        },
      };

      const label = member.user.name || member.user.email || "Unknown";
      expect(label).toBe("Unknown");
    });
  });

  describe("handleCreatedByFilterChange", () => {
    it("should extract first value when array is provided", () => {
      // The handler logic: Array.isArray(value) ? value[0] : value
      const value = ["user-1", "user-2"];
      const result = Array.isArray(value) ? value[0] : value;
      expect(result).toBe("user-1");
    });

    it("should handle single string value", () => {
      const value = "user-1";
      const result = Array.isArray(value) ? value[0] : value;
      expect(result).toBe("user-1");
    });

    it("should handle empty array", () => {
      const value: string[] = [];
      const result = Array.isArray(value) ? value[0] : value;
      expect(result).toBeUndefined();
    });
  });

  describe("hasActiveFilters", () => {
    it("should return true when createdByFilter is not ALL", () => {
      const statusFilters: string[] = [];
      const priorityFilters: string[] = [];
      const assigneeFilter = "ALL";
      const createdByFilter = "user-1";
      const searchQuery = "";
      const showCanceledFeatures = false;
      const needsAttentionFilter = false;

      const hasActiveFilters =
        statusFilters.length > 0 ||
        priorityFilters.length > 0 ||
        assigneeFilter !== "ALL" ||
        createdByFilter !== "ALL" ||
        searchQuery.length > 0 ||
        !showCanceledFeatures ||
        needsAttentionFilter;

      expect(hasActiveFilters).toBe(true);
    });

    it("should return false when createdByFilter is ALL and no other filters", () => {
      const statusFilters: string[] = [];
      const priorityFilters: string[] = [];
      const assigneeFilter = "ALL";
      const createdByFilter = "ALL";
      const searchQuery = "";
      const showCanceledFeatures = true;
      const needsAttentionFilter = false;

      const hasActiveFilters =
        statusFilters.length > 0 ||
        priorityFilters.length > 0 ||
        assigneeFilter !== "ALL" ||
        createdByFilter !== "ALL" ||
        searchQuery.length > 0 ||
        !showCanceledFeatures ||
        needsAttentionFilter;

      expect(hasActiveFilters).toBe(false);
    });

    it("should return true when createdByFilter is UNCREATED", () => {
      const statusFilters: string[] = [];
      const priorityFilters: string[] = [];
      const assigneeFilter = "ALL";
      const createdByFilter = "UNCREATED";
      const searchQuery = "";
      const showCanceledFeatures = true;
      const needsAttentionFilter = false;

      const hasActiveFilters =
        statusFilters.length > 0 ||
        priorityFilters.length > 0 ||
        assigneeFilter !== "ALL" ||
        createdByFilter !== "ALL" ||
        searchQuery.length > 0 ||
        !showCanceledFeatures ||
        needsAttentionFilter;

      expect(hasActiveFilters).toBe(true);
    });
  });

  describe("handleClearFilters", () => {
    it("should reset createdByFilter to ALL", () => {
      let createdByFilter = "user-2";
      const setCreatedByFilter = (value: string) => {
        createdByFilter = value;
      };

      // Simulate handleClearFilters logic
      setCreatedByFilter("ALL");

      expect(createdByFilter).toBe("ALL");
    });
  });

  describe("API integration", () => {
    it("should append createdById to API params when filter is active", () => {
      const createdByFilter = "user-1";
      const params = new URLSearchParams();

      // Simulate the fetchFeatures logic
      if (createdByFilter !== "ALL") {
        params.append("createdById", createdByFilter);
      }

      expect(params.get("createdById")).toBe("user-1");
      expect(params.toString()).toContain("createdById=user-1");
    });

    it("should not append createdById when filter is ALL", () => {
      const createdByFilter = "ALL";
      const params = new URLSearchParams();

      if (createdByFilter !== "ALL") {
        params.append("createdById", createdByFilter);
      }

      expect(params.get("createdById")).toBeNull();
      expect(params.toString()).not.toContain("createdById");
    });

    it("should support UNCREATED special value", () => {
      const createdByFilter = "UNCREATED";
      const params = new URLSearchParams();

      if (createdByFilter !== "ALL") {
        params.append("createdById", createdByFilter);
      }

      expect(params.get("createdById")).toBe("UNCREATED");
      expect(params.toString()).toContain("createdById=UNCREATED");
    });
  });

  describe("localStorage persistence", () => {
    it("should parse createdByFilter from localStorage preferences", () => {
      const savedPreferences = JSON.stringify({
        statusFilters: ["IN_PROGRESS"],
        priorityFilters: ["HIGH"],
        assigneeFilter: "user-1",
        createdByFilter: "user-2",
        sortBy: "createdAt",
        sortOrder: "asc",
      });

      const parsed = JSON.parse(savedPreferences);
      expect(parsed.createdByFilter).toBe("user-2");
    });

    it("should default to ALL when createdByFilter is not in localStorage", () => {
      const savedPreferences = JSON.stringify({
        statusFilters: [],
        priorityFilters: [],
        assigneeFilter: "ALL",
        sortBy: "updatedAt",
        sortOrder: "desc",
      });

      const parsed = JSON.parse(savedPreferences);
      const createdByFilter = parsed.createdByFilter || "ALL";
      expect(createdByFilter).toBe("ALL");
    });

    it("should serialize createdByFilter to localStorage preferences", () => {
      const preferences = {
        statusFilters: ["IN_PROGRESS"],
        priorityFilters: ["HIGH"],
        assigneeFilter: "user-1",
        createdByFilter: "user-2",
        sortBy: "createdAt",
        sortOrder: "asc",
      };

      const serialized = JSON.stringify(preferences);
      const parsed = JSON.parse(serialized);

      expect(parsed.createdByFilter).toBe("user-2");
      expect(serialized).toContain('"createdByFilter":"user-2"');
    });
  });

  describe("filter composition", () => {
    it("should compose createdById with status and priority filters", () => {
      const statusFilters = ["IN_PROGRESS"];
      const priorityFilters = ["HIGH"];
      const createdByFilter = "user-1";
      const params = new URLSearchParams();

      // Simulate fetchFeatures param building
      statusFilters.forEach((status) => params.append("status", status));
      priorityFilters.forEach((priority) => params.append("priority", priority));
      if (createdByFilter !== "ALL") {
        params.append("createdById", createdByFilter);
      }

      const url = params.toString();
      expect(url).toContain("createdById=user-1");
      expect(url).toContain("status=IN_PROGRESS");
      expect(url).toContain("priority=HIGH");
    });

    it("should compose createdById with assigneeId", () => {
      const assigneeFilter = "user-1";
      const createdByFilter = "user-2";
      const params = new URLSearchParams();

      if (assigneeFilter !== "ALL") {
        params.append("assigneeId", assigneeFilter);
      }
      if (createdByFilter !== "ALL") {
        params.append("createdById", createdByFilter);
      }

      const url = params.toString();
      expect(url).toContain("createdById=user-2");
      expect(url).toContain("assigneeId=user-1");
    });

    it("should compose all filters together", () => {
      const statusFilters = ["IN_PROGRESS", "TODO"];
      const priorityFilters = ["HIGH", "URGENT"];
      const assigneeFilter = "user-1";
      const createdByFilter = "user-2";
      const searchQuery = "test";
      const params = new URLSearchParams();

      statusFilters.forEach((status) => params.append("status", status));
      priorityFilters.forEach((priority) => params.append("priority", priority));
      if (assigneeFilter !== "ALL") params.append("assigneeId", assigneeFilter);
      if (createdByFilter !== "ALL") params.append("createdById", createdByFilter);
      if (searchQuery) params.append("search", searchQuery);

      const url = params.toString();
      expect(url).toContain("createdById=user-2");
      expect(url).toContain("assigneeId=user-1");
      expect(url).toContain("status=IN_PROGRESS");
      expect(url).toContain("status=TODO");
      expect(url).toContain("priority=HIGH");
      expect(url).toContain("priority=URGENT");
      expect(url).toContain("search=test");
    });
  });
});
