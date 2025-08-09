import { BaseServiceClass } from "@/lib/base-service";
import { db } from "@/lib/db";
import type { ServiceConfig } from "@/types";
import type { EnsureWebhookParams, DeleteWebhookParams } from "@/types/github";
import crypto from "node:crypto";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";

export class WebhookService extends BaseServiceClass {
  public readonly serviceName = "githubWebhook";

  constructor(config: ServiceConfig) {
    super(config);
  }

  async ensureRepoWebhook({
    userId,
    workspaceId,
    repositoryUrl,
    callbackUrl,
    events = ["push"],
    active = true,
  }: EnsureWebhookParams): Promise<{ id: number; secret: string }> {
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
      const secret =
        repoRec.githubWebhookSecret || crypto.randomBytes(32).toString("hex");
      if (!repoRec.githubWebhookSecret) {
        await db.repository.update({
          where: { id: repoRec.id },
          data: {
            githubWebhookId: String(existing.id),
            githubWebhookSecret: secret,
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
        githubWebhookSecret: secret,
      },
    });

    return { id: created.id, secret };
  }

  async deleteRepoWebhook({
    userId,
    repositoryUrl,
    workspaceId,
  }: DeleteWebhookParams): Promise<void> {
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
    const account = await db.account.findFirst({
      where: { userId, provider: "github" },
      select: { access_token: true },
    });
    if (!account?.access_token) {
      throw new Error("GitHub access token not found for user");
    }
    const { EncryptionService } = await import("@/lib/encryption");
    const enc = EncryptionService.getInstance();
    return enc.decryptField("access_token", account.access_token);
  }

  private async listHooks(
    token: string,
    owner: string,
    repo: string,
  ): Promise<Array<{ id: number; config?: { url?: string } }>> {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks?per_page=100`,
      {
        method: "GET",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );
    if (!res.ok) throw new Error(`Failed to list webhooks: ${res.status}`);
    return (await res.json()) as Array<{
      id: number;
      config?: { url?: string };
    }>;
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
    const res = await fetch(
      `https://api.github.com/repos/${params.owner}/${params.repo}/hooks`,
      {
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
      },
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(
        `Failed to create webhook: ${res.status} ${JSON.stringify(data)}`,
      );
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
    const res = await fetch(
      `https://api.github.com/repos/${params.owner}/${params.repo}/hooks/${params.hookId}`,
      {
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
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to update webhook: ${res.status} ${err}`);
    }
  }

  private async deleteHook(
    token: string,
    owner: string,
    repo: string,
    hookId: number,
  ): Promise<void> {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks/${hookId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to delete webhook: ${res.status} ${err}`);
    }
  }
}
