export const extractRepoInfoFromUrl = (url: string) => {
  try {
    // Handle various GitHub URL formats
    const githubMatch = url.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (githubMatch) {
      return {
        owner: githubMatch[1],
        name: githubMatch[2]
      };
    }
    return null;
  } catch (error) {
    console.error("Error extracting repo info from URL:", error);
    return null;
  }
};
