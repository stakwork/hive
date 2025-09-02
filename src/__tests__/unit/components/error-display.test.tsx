import { describe, test, expect } from "vitest";
import { classifyError } from "@/components/ui/error-display";
import { WORKSPACE_ERRORS } from "@/lib/constants";

describe("classifyError utility", () => {
  test("should classify known workspace errors", () => {
    const config = classifyError(WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED);
    
    expect(config.type).toBe("error");
    expect(config.title).toBe("Workspace Limit Reached");
    expect(config.description).toBe("You can only create up to 2 workspaces.");
    expect(config.helpText).toBe("You can delete an existing workspace to create a new one.");
  });

  test("should classify unknown errors with defaults", () => {
    const unknownError = "Random error message";
    const config = classifyError(unknownError);
    
    expect(config.type).toBe("error");
    expect(config.title).toBe("Something went wrong");
    expect(config.description).toBe(unknownError);
  });
});


