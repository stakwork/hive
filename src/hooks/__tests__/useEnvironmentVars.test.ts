import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useEnvironmentVars } from "../useEnvironmentVars";

describe("useEnvironmentVars", () => {
  describe("initialization", () => {
    it("should initialize with default empty variable", () => {
      const { result } = renderHook(() => useEnvironmentVars());

      expect(result.current.envVars).toEqual([{ name: "", value: "", show: false }]);
    });

    it("should initialize with provided variables", () => {
      const initialVars = [
        { name: "API_KEY", value: "secret123", show: false },
        { name: "DB_HOST", value: "localhost", show: false },
      ];

      const { result } = renderHook(() => useEnvironmentVars(initialVars));

      expect(result.current.envVars).toEqual(initialVars);
    });
  });

  describe("handleEnvChange", () => {
    it("should update variable name", () => {
      const { result } = renderHook(() => useEnvironmentVars());

      act(() => {
        result.current.handleEnvChange(0, "name", "API_KEY");
      });

      expect(result.current.envVars[0].name).toBe("API_KEY");
    });

    it("should update variable value", () => {
      const { result } = renderHook(() => useEnvironmentVars());

      act(() => {
        result.current.handleEnvChange(0, "value", "secret123");
      });

      expect(result.current.envVars[0].value).toBe("secret123");
    });

    it("should toggle show field", () => {
      const { result } = renderHook(() => useEnvironmentVars());

      act(() => {
        result.current.handleEnvChange(0, "show", true);
      });

      expect(result.current.envVars[0].show).toBe(true);
    });

    it("should only update the specified index", () => {
      const initialVars = [
        { name: "VAR1", value: "value1", show: false },
        { name: "VAR2", value: "value2", show: false },
      ];
      const { result } = renderHook(() => useEnvironmentVars(initialVars));

      act(() => {
        result.current.handleEnvChange(1, "value", "updated");
      });

      expect(result.current.envVars[0].value).toBe("value1");
      expect(result.current.envVars[1].value).toBe("updated");
    });
  });

  describe("handleAddEnv", () => {
    it("should add a new empty variable", () => {
      const { result } = renderHook(() => useEnvironmentVars());

      act(() => {
        result.current.handleAddEnv();
      });

      expect(result.current.envVars).toHaveLength(2);
      expect(result.current.envVars[1]).toEqual({
        name: "",
        value: "",
        show: false,
      });
    });

    it("should preserve existing variables when adding new one", () => {
      const initialVars = [{ name: "EXISTING", value: "value", show: false }];
      const { result } = renderHook(() => useEnvironmentVars(initialVars));

      act(() => {
        result.current.handleAddEnv();
      });

      expect(result.current.envVars[0]).toEqual(initialVars[0]);
      expect(result.current.envVars[1]).toEqual({
        name: "",
        value: "",
        show: false,
      });
    });
  });

  describe("handleRemoveEnv", () => {
    it("should remove variable at specified index", () => {
      const initialVars = [
        { name: "VAR1", value: "value1", show: false },
        { name: "VAR2", value: "value2", show: false },
        { name: "VAR3", value: "value3", show: false },
      ];
      const { result } = renderHook(() => useEnvironmentVars(initialVars));

      act(() => {
        result.current.handleRemoveEnv(1);
      });

      expect(result.current.envVars).toHaveLength(2);
      expect(result.current.envVars[0].name).toBe("VAR1");
      expect(result.current.envVars[1].name).toBe("VAR3");
    });
  });

  describe("setEnvVars", () => {
    it("should replace all variables", () => {
      const { result } = renderHook(() => useEnvironmentVars());
      const newVars = [
        { name: "NEW1", value: "value1", show: false },
        { name: "NEW2", value: "value2", show: false },
      ];

      act(() => {
        result.current.setEnvVars(newVars);
      });

      expect(result.current.envVars).toEqual(newVars);
    });
  });

  describe("bulkAddEnvVars", () => {
    it("should add new variables when none exist", () => {
      const { result } = renderHook(() => useEnvironmentVars());

      act(() => {
        result.current.bulkAddEnvVars({
          API_KEY: "secret123",
          DB_HOST: "localhost",
        });
      });

      expect(result.current.envVars).toHaveLength(2);
      expect(result.current.envVars).toContainEqual({
        name: "API_KEY",
        value: "secret123",
        show: false,
      });
      expect(result.current.envVars).toContainEqual({
        name: "DB_HOST",
        value: "localhost",
        show: false,
      });
    });

    it("should update existing variables with new values", () => {
      const initialVars = [
        { name: "API_KEY", value: "old_secret", show: false },
        { name: "DB_HOST", value: "old_host", show: false },
      ];
      const { result } = renderHook(() => useEnvironmentVars(initialVars));

      act(() => {
        result.current.bulkAddEnvVars({
          API_KEY: "new_secret",
          DB_HOST: "new_host",
        });
      });

      expect(result.current.envVars).toHaveLength(2);
      expect(result.current.envVars.find((v) => v.name === "API_KEY")?.value).toBe("new_secret");
      expect(result.current.envVars.find((v) => v.name === "DB_HOST")?.value).toBe("new_host");
    });

    it("should preserve show state when updating existing variables", () => {
      const initialVars = [{ name: "API_KEY", value: "old_secret", show: true }];
      const { result } = renderHook(() => useEnvironmentVars(initialVars));

      act(() => {
        result.current.bulkAddEnvVars({
          API_KEY: "new_secret",
        });
      });

      expect(result.current.envVars[0].show).toBe(true);
      expect(result.current.envVars[0].value).toBe("new_secret");
    });

    it("should add new variables and update existing ones in same operation", () => {
      const initialVars = [{ name: "EXISTING_KEY", value: "old_value", show: false }];
      const { result } = renderHook(() => useEnvironmentVars(initialVars));

      act(() => {
        result.current.bulkAddEnvVars({
          EXISTING_KEY: "updated_value",
          NEW_KEY: "new_value",
        });
      });

      expect(result.current.envVars).toHaveLength(2);
      expect(result.current.envVars.find((v) => v.name === "EXISTING_KEY")?.value).toBe("updated_value");
      expect(result.current.envVars.find((v) => v.name === "NEW_KEY")?.value).toBe("new_value");
    });

    it("should remove empty placeholder when adding variables", () => {
      const { result } = renderHook(() => useEnvironmentVars());

      act(() => {
        result.current.bulkAddEnvVars({
          API_KEY: "secret",
        });
      });

      expect(result.current.envVars).toHaveLength(1);
      expect(result.current.envVars[0].name).toBe("API_KEY");
    });

    it("should skip empty keys", () => {
      const { result } = renderHook(() => useEnvironmentVars());

      act(() => {
        result.current.bulkAddEnvVars({
          "": "empty_key_value",
          VALID_KEY: "valid_value",
        });
      });

      expect(result.current.envVars).toHaveLength(1);
      expect(result.current.envVars[0].name).toBe("VALID_KEY");
    });

    it("should return default empty variable when no valid variables exist", () => {
      const { result } = renderHook(() => useEnvironmentVars());

      act(() => {
        result.current.bulkAddEnvVars({});
      });

      expect(result.current.envVars).toEqual([{ name: "", value: "", show: false }]);
    });

    it("should not create duplicates", () => {
      const initialVars = [{ name: "API_KEY", value: "old_value", show: false }];
      const { result } = renderHook(() => useEnvironmentVars(initialVars));

      act(() => {
        result.current.bulkAddEnvVars({
          API_KEY: "new_value",
        });
      });

      const apiKeyCount = result.current.envVars.filter((v) => v.name === "API_KEY").length;
      expect(apiKeyCount).toBe(1);
    });

    it("should handle multiple updates to the same key", () => {
      const initialVars = [{ name: "API_KEY", value: "value1", show: false }];
      const { result } = renderHook(() => useEnvironmentVars(initialVars));

      act(() => {
        result.current.bulkAddEnvVars({ API_KEY: "value2" });
      });

      act(() => {
        result.current.bulkAddEnvVars({ API_KEY: "value3" });
      });

      expect(result.current.envVars).toHaveLength(1);
      expect(result.current.envVars[0].value).toBe("value3");
    });
  });
});
