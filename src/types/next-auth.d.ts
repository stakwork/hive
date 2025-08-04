import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      defaultWorkspaceSlug?: string;
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
