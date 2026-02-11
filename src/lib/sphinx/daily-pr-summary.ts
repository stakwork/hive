import { logger } from "@/lib/logger";

const SPHINX_API_URL = "https://bots.v2.sphinx.chat/api/action";

export interface MergedPR {
  number: number;
  title: string;
  url: string;
  mergedAt: Date;
}

export interface SphinxConfig {
  chatPubkey: string;
  botId: string;
  botSecret: string;
}

/**
 * Fetch PRs merged in the last 24 hours from GitHub
 */
export async function getMergedPRsForRepo(
  repoFullName: string,
  githubToken: string
): Promise<MergedPR[]> {
  try {
    // Calculate 24 hours ago
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since = yesterday.toISOString().split("T")[0]; // Format as YYYY-MM-DD

    // Use GitHub Search API to find PRs merged in the last 24 hours
    const searchQuery = `repo:${repoFullName} is:pr is:merged merged:>=${since}`;
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}`;

    logger.debug("[PR SUMMARY] Fetching merged PRs from GitHub", "SPHINX_PR_SUMMARY", { repoFullName, since });

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${githubToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const prs = data.items || [];

    // Map to our format
    // Note: Search API returns merged_at inside pull_request object
    const mergedPRs: MergedPR[] = prs
      .filter((pr: any) => pr.pull_request?.merged_at)
      .map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        mergedAt: new Date(pr.pull_request.merged_at),
      }));

    return mergedPRs;
  } catch (error) {
    logger.error("[PR SUMMARY] Error fetching merged PRs", "SPHINX_PR_SUMMARY", { error, repoFullName });
    throw error;
  }
}

/**
 * Format the PR summary message for Sphinx
 */
export function formatPRSummaryMessage(
  mergedPRs: MergedPR[],
  repoName: string,
  workspaceName: string
): string {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let content = `Daily Development Update - ${workspaceName}\n${date}\n\n`;

  if (mergedPRs.length === 0) {
    content += `No pull requests were merged in the last 24 hours.`;
  } else {
    content += `${mergedPRs.length} pull request${mergedPRs.length > 1 ? "s" : ""} merged in ${repoName}:\n\n`;

    mergedPRs.forEach((pr, index) => {
      content += `${index + 1}. ${pr.title}\n   ${pr.url}\n\n`;
    });
  }

  return content;
}

/**
 * Send a message to Sphinx tribe
 */
export async function sendToSphinx(
  config: SphinxConfig,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const response = await fetch(SPHINX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_pubkey: config.chatPubkey,
        bot_id: config.botId,
        bot_secret: config.botSecret,
        content: message,
        action: "broadcast",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sphinx API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    // Check for explicit error responses
    if (result.success === false || result.error) {
      throw new Error(`Sphinx returned error: ${result.error || "Unknown error"}`);
    }

    // Validate message was sent
    if (!result.message_id && result.success !== true) {
      throw new Error("Sphinx did not confirm message was sent - missing message_id");
    }

    return { success: true, messageId: result.message_id };
  } catch (error) {
    logger.error("[SPHINX] Error sending message", "SPHINX", { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
