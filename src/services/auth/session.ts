import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import type { AuthSession } from "@/types/auth";
import { createAuthError } from "./errors";

/**
 * Service for managing user sessions
 */
export class SessionService {
  /**
   * Get the current authenticated session
   */
  public async getSession(): Promise<AuthSession | null> {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return null;
    }

    return {
      user: {
        id: (session.user as any).id,
        email: session.user.email || "",
        name: session.user.name || "",
        image: session.user.image || undefined,
        github: (session.user as any).github,
      },
      expires: session.expires,
    };
  }

  /**
   * Require an authenticated session or throw an error
   */
  public async requireAuth(): Promise<AuthSession> {
    const session = await this.getSession();
    if (!session) {
      throw createAuthError("UNAUTHENTICATED", "Authentication required");
    }
    return session;
  }

  /**
   * Get the current user ID if authenticated
   */
  public async getUserId(): Promise<string | null> {
    const session = await this.getSession();
    return session?.user.id || null;
  }

  /**
   * Check if the current request is authenticated
   */
  public async isAuthenticated(): Promise<boolean> {
    const session = await this.getSession();
    return !!session;
  }
}