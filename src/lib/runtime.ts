export function isDevelopmentMode(): boolean {
  return process.env.DEVELOPMENT === "true";
}

// Centralized toggle for Swarm fake mode, controlled solely by DEVELOPMENT
export function isSwarmFakeModeEnabled(): boolean {
  return isDevelopmentMode();
}
