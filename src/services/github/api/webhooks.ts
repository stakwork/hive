export async function fetchLatestCommitHash(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string = "main",
): Promise<{ hash: string; date: Date } | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=1`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const commits = await response.json();
    const latestCommit = commits[0];

    if (!latestCommit) {
      return null;
    }

    return {
      hash: latestCommit.sha,
      date: new Date(latestCommit.commit.author.date),
    };
  } catch {
    return null;
  }
}

export async function ensureRepoWebhook(
  accessToken: string,
  owner: string,
  repo: string,
  webhookUrl: string,
  webhookSecret: string,
): Promise<boolean> {
  try {
    const existingWebhooks = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!existingWebhooks.ok) {
      return false;
    }

    const webhooks = await existingWebhooks.json();
    const existingWebhook = webhooks.find(
      (hook: { config: { url: string } }) => hook.config.url === webhookUrl,
    );

    if (existingWebhook) {
      return true;
    }

    const webhookData = {
      name: "web",
      active: true,
      events: ["push", "pull_request"],
      config: {
        url: webhookUrl,
        content_type: "json",
        secret: webhookSecret,
      },
    };

    const createResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks`,
      {
        method: "POST",
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
        body: JSON.stringify(webhookData),
      },
    );

    return createResponse.ok;
  } catch {
    return false;
  }
}

export async function listRepoHooks(
  token: string,
  owner: string,
  repo: string,
): Promise<Array<{ id: number; config?: { url?: string } }>> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/hooks?per_page=100`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    },
  );
  if (!res.ok) throw new Error(`Failed to list webhooks: ${res.status}`);
  return (await res.json()) as Array<{ id: number; config?: { url?: string } }>;
}

export async function createRepoHook(params: {
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
        Authorization: `Bearer ${params.token}`,
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

export async function updateRepoHook(params: {
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
        Authorization: `Bearer ${params.token}`,
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

export async function deleteRepoHook(
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
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to delete webhook: ${res.status} ${err}`);
  }
}
