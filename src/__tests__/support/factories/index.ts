/**
 * Factory exports - DB entity creators
 *
 * Factories are imperative functions that CREATE data in the database.
 * Use these when you need actual DB records for integration/E2E tests.
 */

// Core entity factories
export * from "./user.factory";
export * from "./workspace.factory";
export * from "./task.factory";
export * from "./swarm.factory";
export * from "./repository.factory";
export * from "./feature.factory";
export * from "./pod.factory";

// Janitor factories
export * from "./janitor.factory";

// GitHub-specific factories
export * from "./github-webhook.factory";
export * from "./github-numofcommits.factory";
export * from "./github-permissions.factory";

// UI testing factory (React Flow nodes)
export * from "./graphFactory";

// Whiteboard factories
export * from "./whiteboard-message.factory";
