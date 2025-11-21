import { BaseServiceClass } from "@/lib/base-service";
import { db } from "@/lib/db";
import type { ServiceConfig } from "@/types";
import type { DeleteWebhookParams } from "@/types";
import crypto from "node:crypto";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { EncryptionService } from "@/lib/encryption";
import { getGithubUsernameAndPAT } from "@/lib/auth";

const encryptionService = EncryptionService.getInstance();

export class WebhookService extends BaseServiceClass {
  public readonly serviceName = "githubWebhook";

  constructor(config: ServiceConfig) {
    super(config);
  }

  async setupRepositoryWithWebhook({
    userId,
    workspaceId,
    repositoryUrl,
    callbackUrl,
    repositoryName,
    events = ["push", "pull_request"],
    active = true,
  }: {
    userId: string;
    workspaceId: string;
    repositoryUrl: string;
    callbackUrl: string;
    repositoryName: string;
    events?: string[];
    active?: boolean;
  }): Promise<{
    repositoryId: string;
    defaultBranch: string | null;
    webhookId: number;
  }> {
    // Get workspace slug for GitHub credentials
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true },
    });

    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const token = await this.getUserGithubAccessToken(userId, workspace.slug);
    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);

    const repository = await db.repository.upsert({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl,
          workspaceId,
        },
      },
      update: {},
      create: {
        name: repositoryName || repositoryUrl.split("/").pop() || "repo",
        repositoryUrl,
        workspaceId,
      },
    });

    const defaultBranch = await this.detectRepositoryDefaultBranch(token, owner, repo);

    if (defaultBranch) {
      await db.repository.update({
        where: { id: repository.id },
        data: { branch: defaultBranch },
      });
    }

    const webhookResult = await this.ensureRepoWebhook({
      userId,
      workspaceId,
      repositoryUrl,
      callbackUrl,
      events,
      active,
      workspaceSlug: workspace.slug,
    });

    return {
      repositoryId: repository.id,
      defaultBranch,
      webhookId: webhookResult.id,
    };
  }

  private async detectRepositoryDefaultBranch(token: string, owner: string, repo: string): Promise<string | null> {
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (response.ok) {
        const repoInfo = (await response.json()) as { default_branch?: string };
        return repoInfo.default_branch || null;
      }
      if (!response.ok) {
        if (response.status === 403) {
          throw new Error("INSUFFICIENT_PERMISSIONS");
        }
        throw new Error("WEBHOOK_CREATION_FAILED");
      }
    } catch (error) {
      console.error("Failed to detect repository default branch:", error);
    }
    return null;
  }

  async ensureRepoWebhook({
    userId,
    workspaceId,
    repositoryUrl,
    callbackUrl,
    events = ["push", "pull_request"],
    active = true,
    workspaceSlug,
  }: {
    userId: string;
    workspaceId: string;
    repositoryUrl: string;
    callbackUrl: string;
    events?: string[];
    active?: boolean;
    workspaceSlug?: string;
  }): Promise<{ id: number; secret: string }> {
    // Get workspace slug for GitHub credentials if not provided
    let slug = workspaceSlug;
    if (!slug) {
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { slug: true },
      });
      if (!workspace) {
        throw new Error("Workspace not found");
      }
      slug = workspace.slug;
    }

    const token = await this.getUserGithubAccessToken(userId, slug);
    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);

    const repoRec = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: { repositoryUrl, workspaceId },
      },
    });
    if (!repoRec) throw new Error("Repository not found for workspace");

    // Check if this workspace already has a webhook configured
    if (repoRec.githubWebhookId && repoRec.githubWebhookSecret) {
      const webhookId = Number(repoRec.githubWebhookId);
      const webhookExists = await this.verifyHookExists(token, owner, repo, webhookId);

      if (webhookExists) {
        const storedSecret = encryptionService.decryptField("githubWebhookSecret", repoRec.githubWebhookSecret);
        console.log("=> Using existing webhook for workspace", repoRec.id);
        return { id: webhookId, secret: storedSecret };
      }

      // Webhook was deleted in GitHub UI - need to create a new one
      console.log("=> Webhook was deleted in GitHub, creating new webhook", repoRec.id);
    }

    // Create a new webhook for this workspace
    const secret = crypto.randomBytes(32).toString("hex");
    const created = await this.createHook({
      token,
      owner,
      repo,
      url: callbackUrl,
      secret,
      events,
      active,
    });

    console.log("=> Creating new webhook for workspace", repoRec.id);
    await db.repository.update({
      where: { id: repoRec.id },
      data: {
        githubWebhookId: String(created.id),
        githubWebhookSecret: JSON.stringify(encryptionService.encryptField("githubWebhookSecret", secret)),
      },
    });

    return { id: created.id, secret };
  }

  async deleteRepoWebhook({ userId, repositoryUrl, workspaceId }: DeleteWebhookParams): Promise<void> {
    // Get workspace slug for GitHub credentials
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true },
    });

    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const token = await this.getUserGithubAccessToken(userId, workspace.slug);
    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);

    const repoRec = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: { repositoryUrl, workspaceId },
      },
      select: { githubWebhookId: true },
    });
    if (!repoRec?.githubWebhookId) return;

    await this.deleteHook(token, owner, repo, Number(repoRec.githubWebhookId));
    await db.repository.update({
      where: {
        repositoryUrl_workspaceId: { repositoryUrl, workspaceId },
      },
      data: {
        githubWebhookId: null,
        githubWebhookSecret: null,
      },
    });
  }

  private async getUserGithubAccessToken(userId: string, workspaceSlug: string): Promise<string> {
    const githubProfile = await getGithubUsernameAndPAT(userId, workspaceSlug);
    if (!githubProfile?.token) {
      throw new Error("GitHub access token not found for user");
    }
    return githubProfile.token;
  }

  private async verifyHookExists(
    token: string,
    owner: string,
    repo: string,
    hookId: number,
  ): Promise<boolean> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${hookId}`, {
        method: "GET",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
      return res.ok;
    } catch (error) {
      console.error("Failed to verify webhook exists:", error);
      return false;
    }
  }

  private async createHook(params: {
    token: string;
    owner: string;
    repo: string;
    url: string;
    secret: string;
    events: string[];
    active: boolean;
  }): Promise<{ id: number }> {
    const res = await fetch(`https://api.github.com/repos/${params.owner}/${params.repo}/hooks`, {
      method: "POST",
      headers: {
        Authorization: `token ${params.token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "web",
        config: {
          url: params.url,
          content_type: "json",
          secret: params.secret,
          insecure_ssl: "0",
        },
        events: params.events,
        active: params.active,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 403) {
        throw new Error("INSUFFICIENT_PERMISSIONS");
      }
      throw new Error("WEBHOOK_CREATION_FAILED");
    }
    return { id: data.id as number };
  }

  private async deleteHook(token: string, owner: string, repo: string, hookId: number): Promise<void> {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${hookId}`, {
      method: "DELETE",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error("INSUFFICIENT_PERMISSIONS");
      }
      throw new Error("WEBHOOK_CREATION_FAILED");
    }
  }
}
