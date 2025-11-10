import { parseGithubOwnerRepo } from "./repositoryParser";

/**
 * Extracts repository information from a GitHub URL
 * This is a wrapper around parseGithubOwnerRepo that returns null instead of throwing
 * 
 * @param url - GitHub repository URL
 * @returns Object with owner and name properties, or null if parsing fails
 */
export const extractRepoInfoFromUrl = (url: string) => {
  try {
    const { owner, repo } = parseGithubOwnerRepo(url);
    return {
      owner,
      name: repo
    };
  } catch (error) {
    console.error("Error extracting repo info from URL:", error);
    return null;
  }
};
