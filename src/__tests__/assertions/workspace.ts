export const workspaceAssertions = {
  hasCorrectStructure(workspace: unknown) {
    expect(workspace).toHaveProperty("id");
    expect(workspace).toHaveProperty("name");
    expect(workspace).toHaveProperty("slug");
    expect(workspace).toHaveProperty("ownerId");
    expect(workspace).toHaveProperty("createdAt");
    expect(workspace).toHaveProperty("updatedAt");
    expect(typeof (workspace as { createdAt?: unknown }).createdAt).toBe(
      "string",
    );
    expect(typeof (workspace as { updatedAt?: unknown }).updatedAt).toBe(
      "string",
    );
  },

  hasCorrectAccessStructure(workspace: unknown) {
    this.hasCorrectStructure(workspace);
    expect(workspace).toHaveProperty("userRole");
    expect(workspace).toHaveProperty("hasKey");
    expect(workspace).toHaveProperty("owner");
    expect(workspace).toHaveProperty("isCodeGraphSetup");
    expect(typeof (workspace as { hasKey?: unknown }).hasKey).toBe("boolean");
    expect(typeof (workspace as { isCodeGraphSetup?: unknown }).isCodeGraphSetup).toBe(
      "boolean",
    );
  },

  hasCorrectRoleStructure(workspace: unknown) {
    this.hasCorrectStructure(workspace);
    expect(workspace).toHaveProperty("userRole");
    expect(workspace).toHaveProperty("memberCount");
    expect(typeof (workspace as { memberCount?: unknown }).memberCount).toBe(
      "number",
    );
  },

  hasCorrectValidationStructure(validation: unknown) {
    expect(validation).toHaveProperty("hasAccess");
    expect(validation).toHaveProperty("canRead");
    expect(validation).toHaveProperty("canWrite");
    expect(validation).toHaveProperty("canAdmin");
    expect(typeof (validation as { hasAccess?: unknown }).hasAccess).toBe(
      "boolean",
    );
    expect(typeof (validation as { canRead?: unknown }).canRead).toBe("boolean");
    expect(typeof (validation as { canWrite?: unknown }).canWrite).toBe(
      "boolean",
    );
    expect(typeof (validation as { canAdmin?: unknown }).canAdmin).toBe(
      "boolean",
    );
  },
};
