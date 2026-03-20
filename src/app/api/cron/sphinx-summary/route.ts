import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { getAllRepositories } from "@/lib/helpers/repository";
import { getWorkspaceAdminGithubToken } from "@/lib/sphinx/github-token";
import { getMergedPRsForRepo, sendToSphinx, formatPRSummaryMessage } from "@/lib/sphinx/daily-pr-summary";
import type { RepoPRs } from "@/lib/sphinx/daily-pr-summary";

export async function GET(request: NextRequest) {
  // Verify cron authorization
  const isVercelCron = request.headers.get("x-vercel-cron");
  const authHeader = request.headers.get("authorization");

  if (!isVercelCron && process.env.CRON_SECRET) {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  logger.info("[SPHINX CRON] Starting daily PR summary job");

  // Get all workspaces with Sphinx enabled
  const workspaces = await db.workspaces.findMany({
    where: {
      sphinxEnabled: true,
      deleted: false,
      sphinxChatPubkey: { not: null },
      sphinxBotId: { not: null },
      sphinxBotSecret: { not: null },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      sphinxChatPubkey: true,
      sphinxBotId: true,
      sphinxBotSecret: true,
    },
  });

  logger.info(`[SPHINX CRON] Found ${workspaces.length} workspaces with Sphinx enabled`);

  const encryptionService = EncryptionService.getInstance();
  const results: { workspace: string; success: boolean; error?: string; prCount?: number }[] = [];

  for (const workspace of workspaces) {
    try {
      logger.info(`[SPHINX CRON] Processing workspace: ${workspace.slug}`);

      // Get all repositories for the workspace
      const repos = await getAllRepositories(workspace.id);
      if (repos.length === 0) {
        logger.warn(`[SPHINX CRON] No repositories found for workspace: ${workspace.slug}`);
        results.push({ workspace: workspace.slug, success: false, error: "No repositories" });
        continue;
      }

      // Get GitHub token from workspace admin
      const githubToken = await getWorkspaceAdminGithubToken(workspace.slug);
      if (!githubToken) {
        logger.warn(`[SPHINX CRON] No GitHub token available for workspace: ${workspace.slug}`);
        results.push({ workspace: workspace.slug, success: false, error: "No GitHub token" });
        continue;
      }

      // Fetch merged PRs for every repo
      const repoPRs: RepoPRs[] = [];
      let totalPRCount = 0;
      for (const repo of repos) {
        const repoMatch = repo.repositoryUrl.match(/github\.com\/([^/]+\/[^/]+)/);
        if (!repoMatch) {
          logger.warn(`[SPHINX CRON] Invalid repository URL: ${repo.repositoryUrl}`);
          continue;
        }
        const repoFullName = repoMatch[1].replace(/\.git$/, "");
        const mergedPRs = await getMergedPRsForRepo(repoFullName, githubToken);
        logger.info(`[SPHINX CRON] Found ${mergedPRs.length} merged PRs for ${repoFullName}`);
        repoPRs.push({ repoFullName, mergedPRs });
        totalPRCount += mergedPRs.length;
      }

      // Format a single message covering all repos
      const message = formatPRSummaryMessage(repoPRs, workspace.name);

      // Decrypt bot secret and send to Sphinx
      const botSecret = encryptionService.decryptField("sphinxBotSecret", workspace.sphinxBotSecret!);

      const result = await sendToSphinx(
        {
          chatPubkey: workspace.sphinxChatPubkey!,
          botId: workspace.sphinxBotId!,
          botSecret,
        },
        message
      );

      if (result.success) {
        logger.info(`[SPHINX CRON] Successfully sent summary for workspace: ${workspace.slug}`);
        results.push({ workspace: workspace.slug, success: true, prCount: totalPRCount });
      } else {
        logger.error(`[SPHINX CRON] Failed to send to Sphinx for workspace: ${workspace.slug}`, "SPHINX_CRON", { error: result.error });
        results.push({ workspace: workspace.slug, success: false, error: result.error });
      }

    } catch (error) {
      logger.error(`[SPHINX CRON] Error processing workspace: ${workspace.slug}`, "SPHINX_CRON", { error });
      results.push({
        workspace: workspace.slug,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  logger.info(`[SPHINX CRON] Completed: ${successCount}/${workspaces.length} workspaces processed successfully`);

  return NextResponse.json({
    success: true,
    processed: workspaces.length,
    succeeded: successCount,
    results,
  });
}
