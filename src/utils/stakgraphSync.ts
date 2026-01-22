import { ServiceConfig } from "@/services/swarm/db";
import { ServiceDataConfig } from "@/components/stakgraph/types";
import { getPM2AppsContent, parsePM2Content } from "./devContainerUtils";

interface SyncResult {
  services: ServiceConfig[];
  containerFiles: Record<string, string>;
}

/**
 * Merge services by name - incoming services overwrite existing ones with the same name
 */
export function mergeServices(existing: ServiceConfig[], incoming: ServiceConfig[]): ServiceConfig[] {
  const serviceMap = new Map<string, ServiceConfig>();
  for (const service of existing) serviceMap.set(service.name, service);
  for (const service of incoming) serviceMap.set(service.name, service);
  return Array.from(serviceMap.values());
}

/**
 * Merge containerFiles - incoming files overwrite existing ones with the same key, no deletion
 */
export function mergeContainerFiles(
  existing: Record<string, string>,
  incoming: Record<string, string>
): Record<string, string> {
  return { ...existing, ...incoming };
}

/**
 * Synchronize pm2.config.js and services bidirectionally with merge support
 *
 * Cases:
 * 1. Neither sent → return existing unchanged
 * 2. Only services sent → merge services + regenerate pm2.config.js
 * 3. Only pm2.config.js sent → merge files + parse PM2 → update services
 * 4. Both sent → services wins, regenerate pm2.config.js
 * 5. Only other containerFiles sent (no pm2, no services) → merge files only
 */
export function syncPM2AndServices(
  existingServices: ServiceConfig[],
  existingContainerFiles: Record<string, string>,
  incomingServices: ServiceConfig[] | undefined,
  incomingContainerFiles: Record<string, string> | undefined,
  repoName: string
): SyncResult {
  const hasIncomingServices = incomingServices && incomingServices.length > 0;
  const hasIncomingPM2 = incomingContainerFiles?.["pm2.config.js"];

  // Case 1: Neither sent - return existing
  if (!hasIncomingServices && !incomingContainerFiles) {
    return { services: existingServices, containerFiles: existingContainerFiles };
  }

  // Case 5: Only non-pm2 containerFiles sent (e.g., Dockerfile, docker-compose.yml)
  // Just merge files, don't touch services
  if (!hasIncomingServices && incomingContainerFiles && !hasIncomingPM2) {
    const mergedFiles = mergeContainerFiles(existingContainerFiles, incomingContainerFiles);
    return { services: existingServices, containerFiles: mergedFiles };
  }

  // Case 2: Only services sent - regenerate pm2.config.js
  if (hasIncomingServices && !hasIncomingPM2) {
    const mergedServices = mergeServices(existingServices, incomingServices);
    const pm2Content = getPM2AppsContent(repoName, mergedServices as ServiceDataConfig[]);
    const mergedFiles = mergeContainerFiles(existingContainerFiles, incomingContainerFiles || {});
    mergedFiles["pm2.config.js"] = Buffer.from(pm2Content.content).toString("base64");
    return { services: mergedServices, containerFiles: mergedFiles };
  }

  // Case 3: Only pm2.config.js sent (no services or empty services) - parse and update services
  if (!hasIncomingServices && hasIncomingPM2) {
    // Decode base64 before parsing since containerFiles are stored as base64
    const decodedPM2 = Buffer.from(incomingContainerFiles["pm2.config.js"], "base64").toString("utf-8");
    const parsedServices = parsePM2Content(decodedPM2);
    const mergedServices = mergeServices(existingServices, parsedServices);
    const mergedFiles = mergeContainerFiles(existingContainerFiles, incomingContainerFiles);
    return { services: mergedServices, containerFiles: mergedFiles };
  }

  // Case 4: Both sent - services wins, regenerate pm2.config.js
  console.warn("[syncPM2AndServices] Both services and pm2.config.js provided, using services array");
  const mergedServices = mergeServices(existingServices, incomingServices!);
  const pm2Content = getPM2AppsContent(repoName, mergedServices as ServiceDataConfig[]);
  const mergedFiles = mergeContainerFiles(existingContainerFiles, incomingContainerFiles || {});
  mergedFiles["pm2.config.js"] = Buffer.from(pm2Content.content).toString("base64");
  return { services: mergedServices, containerFiles: mergedFiles };
}

/**
 * Extract repository name from GitHub URL
 */
export function extractRepoName(repositoryUrl: string | undefined): string {
  if (!repositoryUrl) return "workspace";
  const match = repositoryUrl.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1]?.replace(/\.git$/i, "") || "workspace";
}
