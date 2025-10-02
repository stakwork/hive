import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { getDefaultWorkspaceForUser } from "@/services/workspace";
import { ensureMockWorkspaceForUser } from "@/utils/mockSetup";
import { PrismaAdapter } from "@auth/prisma-adapter";
import axios from "axios";
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";

const encryptionService: EncryptionService = EncryptionService.getInstance();

// Extend the Profile type for GitHub
interface GitHubProfile {
  id: number;
  login: string;
  node_id: string;
  name: string;
  email: string;
  bio: string;
  company: string;
  location: string;
  blog: string;
  twitter_username: string;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
  type: string;
}

// Create providers array based on environment
const getProviders = () => {
  const providers = [];

  // Always include GitHub provider if credentials are available
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.push(
      GitHubProvider({
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        authorization: {
          params: {
            scope: "read:user user:email",
          },
        },
      }),
    );
  }

  // Add mock provider for development when POD_URL is defined
  if (process.env.POD_URL) {
    providers.push(
      CredentialsProvider({
        id: "mock",
        name: "Development Mock Login",
        credentials: {
          username: {
            label: "Username",
            type: "text",
            placeholder: "Enter any username",
          },
        },
        async authorize(credentials) {
          // Mock authentication - accept any username in development
          if (credentials?.username) {
            const username = credentials.username.trim();
            return {
              id: `mock-${username}`,
              name: username,
              email: `${username}@mock.dev`,
              image: `https://avatars.githubusercontent.com/u/1?v=4`, // Generic avatar
            };
          }
          return null;
        },
      }),
    );
  }

  return providers;
};

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  providers: getProviders(),
  callbacks: {
    async signIn({ user, account }) {
      // Handle mock provider sign-in for development
      if (account?.provider === "mock") {
        try {
          // Create or find the mock user in the database
          const existingUser = user.email
            ? await db.user.findUnique({
                where: {
                  email: user.email,
                },
              })
            : null;

          if (!existingUser) {
            // Create a new user for mock authentication
            const newUser = await db.user.create({
              data: {
                name: user.name || "Mock User",
                email: user.email!, // Email is always generated from username
                image: user.image,
                emailVerified: new Date(), // Auto-verify mock users
              },
            });
            user.id = newUser.id;
          } else {
            user.id = existingUser.id;
          }

          await ensureMockWorkspaceForUser(user.id as string);
        } catch (error) {
          console.error("[Mock Auth Error]", error);
          logger.authError("Failed to handle mock authentication", "SIGNIN_MOCK", error);
          return false;
        }
        return true;
      }

      // If this is a GitHub sign-in, we need to handle re-authentication
      if (account?.provider === "github") {
        try {
          // Check if there's an existing user with the same email
          const existingUser = user.email
            ? await db.user.findUnique({
                where: {
                  email: user.email,
                },
              })
            : null;

          if (existingUser) {
            // Check if there's already a GitHub account for this user
            const existingAccount = await db.account.findFirst({
              where: {
                userId: existingUser.id,
                provider: "github",
              },
            });

            if (!existingAccount) {
              // Create a new account record linking GitHub to the existing user
              const encryptedAccessToken = encryptionService.encryptField("access_token", account.access_token ?? "");

              await db.account.create({
                data: {
                  userId: existingUser.id,
                  type: account.type,
                  provider: account.provider,
                  providerAccountId: account.providerAccountId,
                  access_token: JSON.stringify(encryptedAccessToken),
                  refresh_token: account.refresh_token
                    ? JSON.stringify(encryptionService.encryptField("refresh_token", account.refresh_token))
                    : (null as unknown as string | undefined | null),
                  expires_at: account.expires_at as number | undefined | null,
                  token_type: account.token_type as string | undefined | null,
                  scope: account.scope,
                  id_token: account.id_token
                    ? JSON.stringify(encryptionService.encryptField("id_token", account.id_token))
                    : (null as unknown as string | undefined | null),
                  session_state: account.session_state as string | undefined | null,
                },
              });

              // Update the user object to use the existing user's ID
              user.id = existingUser.id;
            } else {
              if (account.access_token) {
                const encryptedAccessToken = encryptionService.encryptField("access_token", account.access_token ?? "");

                await db.account.update({
                  where: { id: existingAccount.id },
                  data: {
                    access_token: JSON.stringify(encryptedAccessToken),
                    scope: account.scope,
                    refresh_token: account.refresh_token
                      ? JSON.stringify(encryptionService.encryptField("refresh_token", account.refresh_token))
                      : existingAccount.refresh_token,
                    id_token: account.id_token
                      ? JSON.stringify(encryptionService.encryptField("id_token", account.id_token))
                      : existingAccount.id_token,
                  },
                });
              }
            }
          }
        } catch (error) {
          logger.authError("Failed to handle GitHub re-authentication", "SIGNIN_GITHUB", error);
        }
      }
      return true;
    },
    async session({ session, user, token }) {
      if (session.user) {
        // For JWT sessions (mock provider), get data from token and attach default workspace
        if (process.env.POD_URL && token) {
          (session.user as { id: string }).id = token.id as string;
          if (token.github) {
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
          try {
            const uid = (session.user as { id: string }).id;
            const ws = await getDefaultWorkspaceForUser(uid);
            if (ws?.slug) {
              (session.user as { defaultWorkspaceSlug?: string }).defaultWorkspaceSlug = ws.slug;
            }
          } catch {}
          return session;
        }

        // For database sessions
        if (user) {
          (session.user as { id: string }).id = user.id;

          // Skip GitHub data fetching for mock users
          if (user.email?.endsWith("@mock.dev")) {
            // For mock users, add mock GitHub data if needed
            (
              session.user as {
                github?: {
                  username?: string;
                  publicRepos?: number;
                  followers?: number;
                };
              }
            ).github = {
              username: user.name?.toLowerCase().replace(/\s+/g, "-") || "mock-user",
              publicRepos: 5,
              followers: 10,
            };
            return session;
          }
        }

        // Check if we already have GitHub data
        let githubAuth = await db.gitHubAuth.findUnique({
          where: { userId: user.id },
        });

        // If not, try to fetch from GitHub and upsert
        if (!githubAuth) {
          // Find the GitHub account for this user
          const account = await db.account.findFirst({
            where: {
              userId: user.id,
              provider: "github",
            },
          });

          if (account && account.access_token) {
            try {
              // Fetch profile from GitHub API
              const { data: githubProfile } = await axios.get<GitHubProfile>("https://api.github.com/user", {
                headers: {
                  Authorization: `token ${encryptionService.decryptField("access_token", account.access_token)}`,
                },
              });

              githubAuth = await db.gitHubAuth.upsert({
                where: { userId: user.id },
                update: {
                  githubUserId: githubProfile.id.toString(),
                  githubUsername: githubProfile.login,
                  githubNodeId: githubProfile.node_id,
                  name: githubProfile.name,
                  bio: githubProfile.bio,
                  company: githubProfile.company,
                  location: githubProfile.location,
                  blog: githubProfile.blog,
                  twitterUsername: githubProfile.twitter_username,
                  publicRepos: githubProfile.public_repos,
                  publicGists: githubProfile.public_gists,
                  followers: githubProfile.followers,
                  following: githubProfile.following,
                  githubCreatedAt: githubProfile.created_at ? new Date(githubProfile.created_at) : null,
                  githubUpdatedAt: githubProfile.updated_at ? new Date(githubProfile.updated_at) : null,
                  accountType: githubProfile.type,
                  scopes: account.scope ? account.scope.split(",") : [],
                },
                create: {
                  userId: user.id,
                  githubUserId: githubProfile.id.toString(),
                  githubUsername: githubProfile.login,
                  githubNodeId: githubProfile.node_id,
                  name: githubProfile.name,
                  bio: githubProfile.bio,
                  company: githubProfile.company,
                  location: githubProfile.location,
                  blog: githubProfile.blog,
                  twitterUsername: githubProfile.twitter_username,
                  publicRepos: githubProfile.public_repos,
                  publicGists: githubProfile.public_gists,
                  followers: githubProfile.followers,
                  following: githubProfile.following,
                  githubCreatedAt: githubProfile.created_at ? new Date(githubProfile.created_at) : null,
                  githubUpdatedAt: githubProfile.updated_at ? new Date(githubProfile.updated_at) : null,
                  accountType: githubProfile.type,
                  scopes: account.scope ? account.scope.split(",") : [],
                },
              });
            } catch (err) {
              console.log(err, "err");
              // If GitHub API fails, just skip
              logger.authWarn("GitHub profile fetch failed, skipping profile sync", "SESSION_GITHUB_API", {
                hasAccount: !!account,
                userId: user.id,
              });
            }
          } else if (account && !account.access_token) {
            // Account exists but token is revoked - this is expected after disconnection
            logger.authInfo("GitHub account token revoked, re-authentication required", "SESSION_TOKEN_REVOKED", {
              userId: user.id,
              provider: account.provider,
            });
          }
        }

        if (githubAuth) {
          (
            session.user as {
              github?: {
                username?: string;
                publicRepos?: number;
                followers?: number;
              };
            }
          ).github = {
            username: githubAuth.githubUsername,
            publicRepos: githubAuth.publicRepos ?? undefined,
            followers: githubAuth.followers ?? undefined,
          };
        }
      }
      return session;
    },
    async jwt({ token, user, account }) {
      // For JWT sessions (mock provider), store user info in token
      if (account?.provider === "mock" && user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
        token.github = {
          username: user.name?.toLowerCase().replace(/\s+/g, "-") || "mock-user",
          publicRepos: 5,
          followers: 10,
        };
      }
      return token;
    },
  },
  events: {
    async linkAccount({ user, account }) {
      try {
        if (account?.provider === "github" && account.access_token) {
          const encryptedToken = JSON.stringify(encryptionService.encryptField("access_token", account.access_token));
          await db.account.updateMany({
            where: {
              userId: user.id,
              provider: "github",
              providerAccountId: account.providerAccountId,
            },
            data: { access_token: encryptedToken },
          });
        }
      } catch (error) {
        logger.authError("Failed to encrypt tokens during account linking", "LINKACCOUNT_ENCRYPTION", error);
      }
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  session: {
    strategy: process.env.POD_URL ? "jwt" : "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};

interface GithubUsernameAndPAT {
  username: string;
  token: string;
}

/**
 * Fetches the GitHub username and token for a given userId.
 * If workspaceSlug is provided, uses workspace-specific app token.
 * If workspaceSlug is omitted, falls back to user's OAuth token from sign-in.
 * Returns { username, token } or null if not found.
 */
export async function getGithubUsernameAndPAT(
  userId: string,
  workspaceSlug?: string,
): Promise<GithubUsernameAndPAT | null> {
  // Check if this is a mock user
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return null;
  }

  // Check for mock user (case insensitive, supports subdomains)
  if (user.email?.toLowerCase().includes("@mock.dev")) {
    return null;
  }

  // Get GitHub username from GitHubAuth
  const githubAuth = await db.gitHubAuth.findUnique({ where: { userId } });
  if (!githubAuth) {
    return null;
  }

  // Check for valid username
  if (!githubAuth.githubUsername || githubAuth.githubUsername.trim() === "") {
    return null;
  }

  // If no workspace provided, use user's OAuth token from Account table
  if (!workspaceSlug) {
    const account = await db.account.findFirst({
      where: {
        userId,
        provider: "github",
      },
    });

    if (!account?.access_token) {
      return null;
    }

    try {
      const encryptionService = EncryptionService.getInstance();
      const token = encryptionService.decryptField("access_token", account.access_token);

      return {
        username: githubAuth.githubUsername,
        token: token,
      };
    } catch (error) {
      console.error("Failed to decrypt OAuth access token:", error);
      return null;
    }
  }

  // Get workspace and its source control org
  const workspace = await db.workspace.findUnique({
    where: { slug: workspaceSlug },
    include: {
      sourceControlOrg: true,
    },
  });

  if (!workspace?.sourceControlOrg) {
    const account = await db.account.findFirst({
      where: {
        userId,
        provider: "github",
      },
    });

    if (!account?.access_token) {
      return null;
    }

    try {
      const encryptionService = EncryptionService.getInstance();
      const token = encryptionService.decryptField("access_token", account.access_token);
      console.error("=> falling back to personal access token!!! Not good");
      return {
        username: githubAuth.githubUsername,
        token: token,
      };
    } catch (error) {
      console.error("Failed to decrypt OAuth access token:", error);
      return null;
    }
  }

  // Get user's token for this source control org
  const sourceControlToken = await db.sourceControlToken.findUnique({
    where: {
      userId_sourceControlOrgId: {
        userId,
        sourceControlOrgId: workspace.sourceControlOrg.id,
      },
    },
  });

  if (!sourceControlToken?.token) {
    return null;
  }

  try {
    const encryptionService = EncryptionService.getInstance();
    const token = encryptionService.decryptField("source_control_token", sourceControlToken.token);

    return {
      username: githubAuth.githubUsername,
      token: token,
    };
  } catch (error) {
    console.error("Failed to decrypt source control token:", error);
    return null;
  }
}
