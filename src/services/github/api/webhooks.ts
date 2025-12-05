import { serviceConfigs } from "@/config/services";

export async function listRepoHooks(
  token: string,
  owner: string,
  repo: string,
): Promise<Array<{ id: number; config?: { url?: string } }>> {
  const res = await fetch(
    `${serviceConfigs.github.baseURL}/repos/${owner}/${repo}/hooks?per_page=100`,
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
    `${serviceConfigs.github.baseURL}/repos/${params.owner}/${params.repo}/hooks`,
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
    `${serviceConfigs.github.baseURL}/repos/${params.owner}/${params.repo}/hooks/${params.hookId}`,
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
    `${serviceConfigs.github.baseURL}/repos/${owner}/${repo}/hooks/${hookId}`,
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
