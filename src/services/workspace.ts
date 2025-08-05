/**
 * @deprecated This file has been refactored into modular services.
 * Import from "@/services/workspace" for all workspace functionality.
 * The new structure provides:
 * - WorkspaceService: Main service class
 * - Individual function exports for backward compatibility
 * - Modular organization with separate CRUD, access, and validation modules
 */

// Re-export everything from the new modular structure for backward compatibility
export * from "./workspace/index";
