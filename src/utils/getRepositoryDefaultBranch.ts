// Function to fetch repository default branch using authenticated request
export const getRepositoryDefaultBranch = async (
  repositoryUrl: string,
  workspaceSlug?: string,
): Promise<string | null> => {
  try {
    // Use our authenticated API endpoint to get repository info
    // Since we've already verified access, this should always work
    const url = `/api/github/repository?repoUrl=${encodeURIComponent(repositoryUrl)}${workspaceSlug ? `&workspaceSlug=${encodeURIComponent(workspaceSlug)}` : ""}`;
    const response = await fetch(url);

    if (response.ok) {
      const repoData = await response.json();
      if (repoData.data?.default_branch) {
        console.log(`Repository default branch: ${repoData.data.default_branch}`);
        return repoData.data.default_branch;
      }
    }

    console.error("Could not fetch repository default branch - setup cannot continue");
    return null;
  } catch (error) {
    console.error("Error fetching repository default branch:", error);
    return null;
  }
};
