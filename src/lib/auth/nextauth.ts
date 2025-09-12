import { NextAuthOptions } from "next-auth";
import { getDefaultWorkspaceForUser } from "@/services/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import axios from "axios";

const encryptionService: EncryptionService = EncryptionService.getInstance();

// Refresh token configuration
const REFRESH_TOKEN_LIFETIME = 7 * 24 * 60 * 60; // 7 days in seconds
const ACCESS_TOKEN_LIFETIME = 15 * 60; // 15 minutes in seconds

// Token interfaces
interface TokenSet {
  accessToken: string;
  refreshToken: string;
  accessTokenExpires: number;
  refreshTokenExpires: number;
}

interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

// Extend the Profile type for GitHub
interface GitHubProfile {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  name: string;
  email: string;
  public_repos?: number;
  followers?: number;
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt", // Always use JWT for refresh token support
    maxAge: 15 * 60, // 15 minutes for access token
    updateAge: 5 * 60, // Update session every 5 minutes if active
  },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user, account }) {
      // Handle initial sign-in
      if (account && user) {
        if (account.provider === "mock") {
          // For mock provider, store user info in token
          token.id = user.id;
          token.email = user.email;
          token.name = user.name;
          token.picture = user.image;
          token.github = {
            username: user.name?.toLowerCase().replace(/\s+/g, "-") || "mock-user",
            publicRepos: 5,
            followers: 10,
          };
          // Mock tokens don't need refresh
          return token;
        }

        if (account.provider === "github") {
          // Store initial GitHub tokens
          const tokenSet = generateTokenSet(
            account.access_token || "",
            account.refresh_token || ""
          );
          
          return {
            ...token,
            id: user.id,
            accessToken: tokenSet.accessToken,
            refreshToken: tokenSet.refreshToken,
            accessTokenExpires: tokenSet.accessTokenExpires,
            refreshTokenExpires: tokenSet.refreshTokenExpires,
            provider: "github",
          };
        }
      }

      // Handle token refresh for subsequent requests
      if (token?.provider === "github" && shouldRefreshToken(token)) {
        try {
          const refreshedTokens = await refreshGitHubToken(token.refreshToken as string);
          
          if (refreshedTokens?.access_token) {
            const newTokenSet = generateTokenSet(
              refreshedTokens.access_token,
              (refreshedTokens.refresh_token || token.refreshToken) as string
            );

            // Update database with new encrypted tokens
            if (token.id) {
              const account = await db.account.findFirst({
                where: { userId: token.id as string, provider: "github" },
              });

              if (account) {
                await db.account.update({
                  where: { id: account.id },
                  data: {
                    access_token: JSON.stringify(
                      encryptionService.encryptField("access_token", newTokenSet.accessToken)
                    ),
                    refresh_token: refreshedTokens.refresh_token
                      ? JSON.stringify(
                          encryptionService.encryptField("refresh_token", refreshedTokens.refresh_token)
                        )
                      : account.refresh_token,
                    expires_at: newTokenSet.accessTokenExpires,
                  },
                });
              }
            }

            return {
              ...token,
              accessToken: newTokenSet.accessToken,
              refreshToken: newTokenSet.refreshToken,
              accessTokenExpires: newTokenSet.accessTokenExpires,
              refreshTokenExpires: newTokenSet.refreshTokenExpires,
            };
          } else {
            // Refresh failed, token is invalid
            console.error("Token refresh failed, user needs to re-authenticate");
            return { ...token, error: "RefreshAccessTokenError" };
          }
        } catch (error) {
          console.error("Error during token refresh:", error);
          return { ...token, error: "RefreshAccessTokenError" };
        }
      }

      // Return existing token if no refresh needed
      return token;
    },
    async session({ session, user, token }) {
      if (session.user) {
        // Handle token refresh errors
        if (token?.error === "RefreshAccessTokenError") {
          // Force re-authentication by clearing session
          return { ...session, error: "RefreshAccessTokenError" };
        }

        // For JWT sessions, get data from token and attach default workspace
        if (token) {
          (session.user as { id: string }).id = token.id as string;
          
          // Handle mock provider tokens
          if (token.github && typeof token.github === "object") {
            (
              session.user as {
                github?: {
                  username?: string;
                  publicRepos?: number;
                  followers?: number;
                };
              }
            ).github = token.github as {
              username?: string;
              publicRepos?: number;
              followers?: number;
            };
          }
          
          // Handle GitHub provider tokens - fetch fresh profile data if needed
          if (token.provider === "github" && token.accessToken && !token.github) {
            try {
              const { data: githubProfile } = await axios.get<GitHubProfile>("https://api.github.com/user", {
                headers: {
                  Authorization: `token ${token.accessToken}`,
                },
              });

              (
                session.user as {
                  github?: {
                    username?: string;
                    publicRepos?: number;
                    followers?: number;
                  };
                }
              ).github = {
                username: githubProfile.login,
                publicRepos: githubProfile.public_repos ?? undefined,
                followers: githubProfile.followers ?? undefined,
              };
            } catch (err) {
              console.error("Failed to fetch GitHub profile with refreshed token:", err);
            }
          }

          try {
            const uid = (session.user as { id: string }).id;
            const ws = await getDefaultWorkspaceForUser(uid);
            if (ws?.slug) {
              (session.user as { defaultWorkspaceSlug?: string }).defaultWorkspaceSlug = ws.slug;
            }
          } catch {}
          return session;
        }
      }
      return session;
    },
  },
};

// Utility function to get providers dynamically
export const getAuthProviders = () => {
  const providers: any[] = [];
  
  // Add your provider setup logic here
  // Example:
  // if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  //   providers.push(
  //     GithubProvider({
  //       clientId: process.env.GITHUB_CLIENT_ID,
  //       clientSecret: process.env.GITHUB_CLIENT_SECRET,
  //     })
  //   );
  // }
  
  return providers;
};

// Utility function to refresh GitHub access token
async function refreshGitHubToken(refreshToken: string): Promise<RefreshTokenResponse | null> {
  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID!,
        client_secret: process.env.GITHUB_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      console.error("Failed to refresh GitHub token:", response.status);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error refreshing GitHub token:", error);
    return null;
  }
}

// Utility function to generate new token set
function generateTokenSet(accessToken: string, refreshToken: string): TokenSet {
  const now = Math.floor(Date.now() / 1000);
  return {
    accessToken,
    refreshToken,
    accessTokenExpires: now + ACCESS_TOKEN_LIFETIME,
    refreshTokenExpires: now + REFRESH_TOKEN_LIFETIME,
  };
}

// Utility function to check if token needs refresh
function shouldRefreshToken(token: any): boolean {
  if (!token?.accessTokenExpires) return false;
  const now = Math.floor(Date.now() / 1000);
  // Refresh if token expires in the next 5 minutes
  return now >= (token.accessTokenExpires - 300);
}

// Utility function to get GitHub username and PAT for a user
export async function getGithubUsernameAndPAT(userId: string) {
  try {
    // Get GitHub username from GitHubAuth table
    const githubAuth = await db.gitHubAuth.findUnique({
      where: { userId },
    });

    // Get GitHub account tokens from Account table
    const account = await db.account.findFirst({
      where: {
        userId,
        provider: "github",
      },
    });

    if (!githubAuth || !account) {
      return null;
    }

    let pat = null;
    let appAccessToken = null;

    // Decrypt access_token if it exists
    if (account.access_token) {
      try {
        pat = encryptionService.decryptField("access_token", account.access_token);
      } catch (error) {
        console.error("Failed to decrypt access_token:", error);
        // If decryption fails, try using the raw value (might be unencrypted)
        pat = account.access_token;
      }
    }

    // Decrypt app_access_token if it exists
    if (account.app_access_token) {
      try {
        appAccessToken = encryptionService.decryptField("access_token", account.app_access_token);
      } catch (error) {
        console.error("Failed to decrypt app_access_token:", error);
        // If decryption fails, try using the raw value (might be unencrypted)
        appAccessToken = account.app_access_token;
      }
    }

    return {
      username: githubAuth.githubUsername,
      pat,
      appAccessToken,
    };
  } catch (error) {
    console.error("Error getting GitHub username and PAT:", error);
    return null;
  }
}