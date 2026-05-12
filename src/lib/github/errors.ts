/**
 * Typed errors for GitHub auto-merge gate
 */

export class AutoMergeNotAllowedError extends Error {
  readonly githubSettingsUrl: string;

  constructor(githubSettingsUrl: string) {
    super("Auto-merge is not allowed on this repository. Enable it in GitHub repository settings.");
    this.name = "AutoMergeNotAllowedError";
    this.githubSettingsUrl = githubSettingsUrl;
  }
}

export class AutoMergeCheckFailedError extends Error {
  constructor(message = "Failed to verify auto-merge setting on GitHub.") {
    super(message);
    this.name = "AutoMergeCheckFailedError";
  }
}
