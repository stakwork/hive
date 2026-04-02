import { logger } from "@/lib/logger";
import { config } from "@/config/env";

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
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`;

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

export interface RepoPRs {
  repoFullName: string;
  mergedPRs: MergedPR[];
}

/**
 * Format the PR summary message for Sphinx (supports multiple repos)
 */
export function formatPRSummaryMessage(
  repoPRs: RepoPRs[],
  workspaceName: string
): string {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  let content = `Daily Development Update - ${workspaceName}\n${date}\n\n`;

  const totalPRs = repoPRs.reduce((sum, r) => sum + r.mergedPRs.length, 0);

  if (totalPRs === 0) {
    content += `No pull requests were merged in the last 24 hours.`;
    return content;
  }

  for (const { repoFullName, mergedPRs } of repoPRs) {
    if (mergedPRs.length === 0) continue;
    content += `${mergedPRs.length} pull request${mergedPRs.length > 1 ? "s" : ""} merged in ${repoFullName}:\n\n`;
    const MAX_SHOWN = 3;
    const shown = mergedPRs.slice(0, MAX_SHOWN);
    const remaining = mergedPRs.length - shown.length;

    shown.forEach((pr, index) => {
      content += `${index + 1}. ${pr.title}\n   ${pr.url}\n\n`;
    });

    if (remaining > 0) {
      content += `... and ${remaining} more\n\n`;
    }
  }

  return content;
}

/**
 * Send a message to Sphinx tribe
 */
export async function sendToSphinx(
  sphinxConfig: SphinxConfig,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const response = await fetch(config.SPHINX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_pubkey: sphinxConfig.chatPubkey,
        bot_id: sphinxConfig.botId,
        bot_secret: sphinxConfig.botSecret,
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
