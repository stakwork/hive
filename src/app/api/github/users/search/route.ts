import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import axios from "axios";
import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query || query.trim().length < 2) {
      return NextResponse.json(
        { error: "Search query must be at least 2 characters" },
        { status: 400 }
      );
    }

    // Get the user's GitHub account
    const account = await db.account.findFirst({
      where: {
        userId: (session.user as { id: string }).id,
        provider: "github",
      },
    });

    if (!account?.access_token) {
      return NextResponse.json(
        { error: "GitHub access token not found" },
        { status: 400 }
      );
    }

    // Search GitHub users
    const response = await axios.get("https://api.github.com/search/users", {
      headers: {
        Authorization: `token ${encryptionService.decryptField("access_token", account.access_token)}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: {
        q: query,
        per_page: 10, // Limit to 10 results
      },
    });

    const users = response.data.items.map((user: Record<string, unknown>) => ({
      id: user.id,
      login: user.login,
      avatar_url: user.avatar_url,
      html_url: user.html_url,
      type: user.type,
      score: user.score,
    }));

    return NextResponse.json({
      users,
      total_count: response.data.total_count,
    });
  } catch (error: unknown) {
    console.error("Error searching GitHub users:", error);

    if (
      error &&
      typeof error === "object" &&
      "response" in error &&
      error.response &&
      typeof error.response === "object" &&
      "status" in error.response &&
      error.response.status === 401
    ) {
      return NextResponse.json(
        { error: "GitHub token expired or invalid" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Failed to search GitHub users" },
      { status: 500 }
    );
  }
}