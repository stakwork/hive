import { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";
import axios from "axios";

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

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "read:user user:email read:org",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // If this is a GitHub sign-in, we need to handle re-authentication
      if (account?.provider === "github") {
        try {
          // Check if there's an existing user with the same email
          const existingUser = user.email ? await db.user.findUnique({
            where: {
              email: user.email,
            },
          }) : null;

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
              await db.account.create({
                data: {
                  userId: existingUser.id,
                  type: account.type,
                  provider: account.provider,
                  providerAccountId: account.providerAccountId,
                  accessToken: account.accessToken as string | undefined | null,
                  refreshToken: account.refreshToken as string | undefined | null,
                  expiresAt: account.expiresAt as number | undefined | null,
                  tokenType: account.tokenType as string | undefined | null,
                  scope: account.scope,
                  idToken: account.idToken as string | undefined | null,
                  sessionState: account.sessionState  as string | undefined | null,
                },
              });

              // Update the user object to use the existing user's ID
              user.id = existingUser.id;
            }
          }
        } catch (error) {
          console.error("Error handling GitHub re-authentication:", error);
        }
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        (session.user as { id: string }).id = user.id;

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

          if (account && account.accessToken) {
            try {
              // Fetch profile from GitHub API
              const { data: githubProfile } = await axios.get<GitHubProfile>(
                "https://api.github.com/user",
                {
                  headers: {
                    Authorization: `token ${account.accessToken}`,
                  },
                }
              );

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
              // If GitHub API fails, just skip
              console.error("Failed to fetch GitHub profile:", err);
            }
          } else if (account && !account.accessToken) {
            // Account exists but token is revoked - this is expected after disconnection
            console.log("GitHub account exists but token is revoked - user needs to re-authenticate");
          }
        }

        if (githubAuth) {
          (session.user as { github?: { username?: string; publicRepos?: number; followers?: number } }).github = {
            username: githubAuth.githubUsername,
            publicRepos: githubAuth.publicRepos ?? undefined,
            followers: githubAuth.followers ?? undefined,
          };
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};

/**
 * Fetches the GitHub username and PAT (accessToken) for a given userId.
 * Returns { username, pat } or null if not found.
 */
export async function getGithubUsernameAndPAT(userId: string): Promise<{ username: string; pat: string } | null> {
  // Get GitHub username from GitHubAuth
  const githubAuth = await db.gitHubAuth.findUnique({ where: { userId } });
  // Get PAT from Account
  const githubAccount = await db.account.findFirst({ where: { userId, provider: 'github' } });
  if (githubAuth?.githubUsername && githubAccount?.accessToken) {
    return { username: githubAuth.githubUsername, pat: githubAccount.accessToken };
  }
  return null;
} 
