import { BaseServiceClass } from "@/lib/base-service";
import { db } from "@/lib/db";
import type { ServiceConfig } from "@/types";
import type { DeleteWebhookParams } from "@/types";
import crypto from "node:crypto";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { EncryptionService } from "@/lib/encryption";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

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
    const token = await this.getUserGithubAccessToken(userId);
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
  }: {
    userId: string;
    workspaceId: string;
    repositoryUrl: string;
    callbackUrl: string;
    events?: string[];
    active?: boolean;
  }): Promise<{ id: number; secret: string }> {
    const token = await this.getUserGithubAccessToken(userId);
    const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);

    const repoRec = await db.repository.findUnique({
      where: {
        repositoryUrl_workspaceId: { repositoryUrl, workspaceId },
      },
    });
    if (!repoRec) throw new Error("Repository not found for workspace");

    const hooks = await this.listHooks(token, owner, repo);
    const existing = hooks.find((h) => h.config?.url === callbackUrl);

    if (existing) {
      await this.updateHook({
        token,
        owner,
        repo,
        hookId: existing.id,
        events,
        active,
      });
      const storedSecret = repoRec.githubWebhookSecret
        ? encryptionService.decryptField("githubWebhookSecret", repoRec.githubWebhookSecret)
        : null;
      const secret = storedSecret || crypto.randomBytes(32).toString("hex");
      if (!repoRec.githubWebhookSecret) {
        await db.repository.update({
          where: { id: repoRec.id },
          data: {
            githubWebhookId: String(existing.id),
            githubWebhookSecret: JSON.stringify(encryptionService.encryptField("githubWebhookSecret", secret)),
          },
        });
      } else if (!repoRec.githubWebhookId) {
        await db.repository.update({
          where: { id: repoRec.id },
          data: { githubWebhookId: String(existing.id) },
        });
      }
      return { id: existing.id, secret };
    }

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
    const token = await this.getUserGithubAccessToken(userId);
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

  private async getUserGithubAccessToken(userId: string): Promise<string> {
    const githubProfile = await getGithubUsernameAndPAT(userId);
    if (!githubProfile?.pat) {
      throw new Error("GitHub access token not found for user");
    }
    return githubProfile.appAccessToken || githubProfile.pat;
  }

  private async listHooks(
    token: string,
    owner: string,
    repo: string,
  ): Promise<Array<{ id: number; config?: { url?: string } }>> {
    const url = `https://api.github.com/repos/${owner}/${repo}/hooks?per_page=100`;
    try {
      const res = await fetch(url, {
        method: "GET",
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
      return (await res.json()) as Array<{
        id: number;
        config?: { url?: string };
      }>;
    } catch (error) {
      console.error("Failed to list hooks at:", url, error);
      throw new Error("WEBHOOK_CREATION_FAILED");
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

  private async updateHook(params: {
    token: string;
    owner: string;
    repo: string;
    hookId: number;
    events: string[];
    active: boolean;
  }): Promise<void> {
    const res = await fetch(`https://api.github.com/repos/${params.owner}/${params.repo}/hooks/${params.hookId}`, {
      method: "PATCH",
      headers: {
        Authorization: `token ${params.token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: params.events,
        active: params.active,
      }),
    });
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error("INSUFFICIENT_PERMISSIONS");
      }
      throw new Error("WEBHOOK_CREATION_FAILED");
    }
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
