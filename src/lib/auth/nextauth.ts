import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
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

/**
 * Increment failed login attempts and apply account lockout if threshold exceeded
 */
async function incrementFailedLoginAttempts(userId: string, email: string): Promise<void> {
  const LOCKOUT_THRESHOLD = 5;
  const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { failedLoginAttempts: true },
    });

    if (!user) return;

    const newAttemptCount = user.failedLoginAttempts + 1;
    const now = new Date();

    if (newAttemptCount >= LOCKOUT_THRESHOLD) {
      // Lock the account
      const lockedUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
      await db.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: newAttemptCount,
          lastFailedLoginAt: now,
          lockedUntil,
        },
      });

      logger.authError(
        "Account locked due to excessive failed login attempts",
        "ACCOUNT_LOCKED",
        {
          userId,
          email,
          attempts: newAttemptCount,
          lockedUntil: lockedUntil.toISOString(),
        }
      );
    } else {
      // Increment counter without locking
      await db.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: newAttemptCount,
          lastFailedLoginAt: now,
        },
      });

      logger.authWarn(
        "Failed login attempt recorded",
        "FAILED_LOGIN_ATTEMPT",
        {
          userId,
          email,
          attempts: newAttemptCount,
          remainingAttempts: LOCKOUT_THRESHOLD - newAttemptCount,
        }
      );
    }
  } catch (error) {
    logger.authError(
      "Failed to update failed login attempts",
      "FAILED_ATTEMPT_UPDATE_ERROR",
      error
    );
  }
}

export const authOptions: NextAuthOptions = {
  // Only use PrismaAdapter when not using credentials provider
  ...(process.env.POD_URL ? {} : { adapter: PrismaAdapter(db) }),
  providers: getProviders(),
  callbacks: {
    async signIn({ user, account }) {
      // Check for account lockout before processing authentication
      if (user.email) {
        const existingUser = await db.user.findUnique({
          where: { email: user.email },
          select: {
            id: true,
            lockedUntil: true,
            permanentlyLocked: true,
            failedLoginAttempts: true,
          },
        });

        if (existingUser) {
          // Check permanent lockout
          if (existingUser.permanentlyLocked) {
            logger.authError(
              "Login attempt blocked - account permanently locked",
              "SIGNIN_PERMANENT_LOCKOUT",
              { userId: existingUser.id, email: user.email }
            );
            return false;
          }

          // Check temporary lockout
          if (existingUser.lockedUntil && existingUser.lockedUntil > new Date()) {
            const remainingSeconds = Math.ceil(
              (existingUser.lockedUntil.getTime() - Date.now()) / 1000
            );
            logger.authError(
              "Login attempt blocked - account temporarily locked",
              "SIGNIN_TEMP_LOCKOUT",
              {
                userId: existingUser.id,
                email: user.email,
                remainingSeconds,
                failedAttempts: existingUser.failedLoginAttempts,
              }
            );
            return false;
          }

          // Update user.id for subsequent logic
          user.id = existingUser.id;
        }
      }

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

          // Create workspace atomically - this MUST succeed for auth to work
          const workspaceSlug = await ensureMockWorkspaceForUser(user.id as string);

          if (!workspaceSlug) {
            logger.authError(
              "Failed to create mock workspace - workspace slug is empty",
              "SIGNIN_MOCK_WORKSPACE_FAILED",
              { userId: user.id }
            );
            return false;
          }

          // Verify workspace was committed to DB before proceeding
          // This ensures subsequent queries in middleware/pages will find it
          const verifyWorkspace = await db.workspace.findFirst({
            where: { ownerId: user.id as string, deleted: false },
            select: { slug: true },
          });

          if (!verifyWorkspace) {
            logger.authError(
              "Mock workspace created but not found on verification - possible transaction issue",
              "SIGNIN_MOCK_VERIFICATION_FAILED",
              { userId: user.id, expectedSlug: workspaceSlug }
            );
            return false;
          }

          logger.authInfo("Mock workspace created successfully", "SIGNIN_MOCK_SUCCESS", {
            userId: user.id,
            workspaceSlug,
          });

          // Reset failed login attempts on successful authentication
          await db.user.update({
            where: { id: user.id as string },
            data: {
              failedLoginAttempts: 0,
              lastFailedLoginAt: null,
              lockedUntil: null,
              lastLoginAt: new Date(),
            },
          });
        } catch (error) {
          logger.authError("Failed to handle mock authentication", "SIGNIN_MOCK", error);
          
          // Increment failed login attempts on authentication failure
          if (user.id) {
            await incrementFailedLoginAttempts(user.id as string, user.email || "unknown");
          }
          
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

            // Reset failed login attempts on successful GitHub authentication
            await db.user.update({
              where: { id: existingUser.id },
              data: {
                failedLoginAttempts: 0,
                lastFailedLoginAt: null,
                lockedUntil: null,
                lastLoginAt: new Date(),
              },
            });
          }
        } catch (error) {
          logger.authError("Failed to handle GitHub re-authentication", "SIGNIN_GITHUB", error);
          
          // Increment failed login attempts on authentication failure
          if (user.id) {
            await incrementFailedLoginAttempts(user.id as string, user.email || "unknown");
          }
        }
      }
      return true;
    },
    async session({ session, user, token }) {
      const userId = user?.id ?? (token?.id as string | undefined);
      const userEmail = user?.email ?? (token?.email as string | undefined);

      if (session.user && userId) {
        (session.user as { id: string }).id = userId;
      }

      if (session.user) {
        // For JWT sessions (mock provider), get data from token
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

          // Get workspace slug that was created in signIn callback
          const uid = (session.user as { id?: string }).id;
          if (uid) {
            try {
              const workspace = await db.workspace.findFirst({
                where: { ownerId: uid, deleted: false },
                select: { slug: true },
              });

              if (workspace?.slug) {
                (session.user as { defaultWorkspaceSlug?: string }).defaultWorkspaceSlug = workspace.slug;
              } else {
                // This should never happen if signIn callback succeeded
                logger.authError(
                  "Mock workspace not found in session callback - signIn may have failed",
                  "SESSION_MOCK_WORKSPACE_MISSING",
                  { userId: uid }
                );
              }
            } catch (error) {
              logger.authError("Failed to query mock workspace in session", "SESSION_MOCK", error);
            }
          } else {
            logger.authWarn("Session missing user id while resolving workspace", "SESSION_WORKSPACE_NO_USER", {
              hasToken: !!token,
            });
          }
          return session;
        }

        const isMockUser = userEmail?.endsWith("@mock.dev");
        if (isMockUser) {
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
            username:
              (user?.name ?? (token?.name as string | undefined))?.toLowerCase().replace(/\s+/g, "-") || "mock-user",
            publicRepos: 5,
            followers: 10,
          };
          return session;
        }

        if (!userId) {
          logger.authWarn(
            "Session callback missing user identifier, skipping GitHub enrichment",
            "SESSION_NO_USER_ID",
            {
              hasToken: !!token,
              hasUser: !!user,
            }
          );
          return session;
        }

        // Check if we already have GitHub data
        let githubAuth = await db.gitHubAuth.findUnique({
          where: { userId },
        });

        // If not, try to fetch from GitHub and upsert
        if (!githubAuth) {
          // Find the GitHub account for this user
          const account = await db.account.findFirst({
            where: {
              userId,
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
                where: { userId },
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
                  userId,
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
                userId,
              });
            }
          } else if (account && !account.access_token) {
            // Account exists but token is revoked - this is expected after disconnection
            logger.authInfo("GitHub account token revoked, re-authentication required", "SESSION_TOKEN_REVOKED", {
              userId,
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
      // Initial sign-in: populate token with user data
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;

        // For mock provider, add mock GitHub data
        if (account?.provider === "mock") {
          token.github = {
            username: user.name?.toLowerCase().replace(/\s+/g, "-") || "mock-user",
            publicRepos: 5,
            followers: 10,
          };
        }
      }
      // Subsequent requests: token already has the data, just return it
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
    strategy: "jwt",
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
