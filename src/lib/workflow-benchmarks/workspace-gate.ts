/**
 * Workspace gate for Workflow Editor Benchmarks.
 * Uses strict isDevelopmentMode() (NODE_ENV === "development").
 * STAK_TOOLKIT_SLUGS / isEvalCaptureEnabled are NOT modified.
 */
import { isEvalCaptureEnabled } from "@/lib/eval-capture-slugs";
import { isDevelopmentMode } from "@/lib/runtime";

export function isBenchmarkWorkspaceAllowed(slug: string): boolean {
  return isEvalCaptureEnabled(slug) || (isDevelopmentMode() && slug === "dev-mock");
}
