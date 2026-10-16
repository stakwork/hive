import { serviceConfigs } from "@/config/services";

export interface UserInstallation {
  id: number;
  account: {
    login: string;
    type: string;
    name?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    description?: string | null;
    bio?: string | null;
  };
}

/**
 * The app installation on `login` (case-insensitive) that the user can see,
 * read with their GitHub App user token. null when there is none or the
 * request fails. Needs no app JWT, so it works for an app installed outside
 * Hive's flow, before Hive has a `SourceControlOrg` for it.
 */
export async function findUserInstallationFor(userAccessToken: string, login: string): Promise<UserInstallation | null> {
  try {
    const response = await fetch(`${serviceConfigs.github.baseURL}/user/installations?per_page=100`, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (!response.ok) {
      console.error("[GitHub] Failed to fetch user installations:", response.status, response.statusText);
      return null;
    }
    const data = (await response.json()) as { installations?: UserInstallation[] };
    const wanted = login.toLowerCase();
    return data.installations?.find((inst) => inst.account?.login?.toLowerCase() === wanted) ?? null;
  } catch (error) {
    console.error("[GitHub] User installations lookup failed:", error);
    return null;
  }
}
