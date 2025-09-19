export function isDevelopmentMode(): boolean {
  console.log("isDevelopmentMode", process.env.NODE_ENV);
  return false && process.env.NODE_ENV === "development";
}

// Centralized toggle for Swarm fake mode, controlled by NODE_ENV=development
export function isSwarmFakeModeEnabled(): boolean {
  return isDevelopmentMode();
}
