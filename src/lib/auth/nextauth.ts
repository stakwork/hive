// Backward compatibility re-exports for NextAuth v5 migration
// This file maintains compatibility with existing imports
// New code should import from @/lib/auth/auth instead

export { auth, authConfig, getGithubUsernameAndPAT } from "./auth";

// Export authOptions for backward compatibility (maps to authConfig)
export { authConfig as authOptions } from "./auth";
