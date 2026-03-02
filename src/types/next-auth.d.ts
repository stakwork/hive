import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      defaultWorkspaceSlug?: string;
      lightningPubkey?: string;
      sphinxAlias?: string;
      isSuperAdmin?: boolean;
      github?: {
        username?: string;
        publicRepos?: number;
        followers?: number;
      };
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "USER" | "ADMIN" | "MODERATOR" | "SUPER_ADMIN";
    github?: {
      username?: string;
      publicRepos?: number;
      followers?: number;
    };
  }
}
