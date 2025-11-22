import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/github/users/check?username=<github_username>
 * Check if a GitHub user exists in Hive system
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");

    if (!username || username.trim().length === 0) {
      return NextResponse.json(
        { error: "GitHub username is required" },
        { status: 400 }
      );
    }

    // Check if user exists in Hive by looking up GitHubAuth
    const githubAuth = await db.gitHubAuth.findFirst({
      where: {
        githubUsername: username.trim(),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            createdAt: true,
            deleted: false,
          },
        },
      },
    });

    if (!githubAuth || !githubAuth.user || githubAuth.user.deleted) {
      // User does not exist in Hive
      return NextResponse.json({
        exists: false,
        isNewUser: true,
        username,
      });
    }

    // User exists in Hive
    return NextResponse.json({
      exists: true,
      isNewUser: false,
      username,
      user: {
        id: githubAuth.user.id,
        name: githubAuth.user.name,
        email: githubAuth.user.email,
        image: githubAuth.user.image,
        createdAt: githubAuth.user.createdAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error("Error checking GitHub user in Hive:", error);
    return NextResponse.json(
      { error: "Failed to check user" },
      { status: 500 }
    );
  }
}
