import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function POST() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user || !(session.user as { id?: string }).id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id: string }).id;

    // Find the GitHub account for this user
    const account = await db.account.findFirst({
      where: {
        userId: userId,
        provider: "github",
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: "No GitHub account found" },
        { status: 404 },
      );
    }

    // Revoke the GitHub OAuth access token
    if (account.access_token) {
      try {
        const response = await fetch(
          "https://api.github.com/applications/revoke",
          {
            method: "DELETE",
            headers: {
              Accept: "application/vnd.github.v3+json",
              "Content-Type": "application/json",
              Authorization: `Basic ${Buffer.from(
                `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`,
              ).toString("base64")}`,
            },
            body: JSON.stringify({
              access_token: encryptionService.decryptField(
                "access_token",
                account.access_token,
              ),
            }),
          },
        );

        if (!response.ok) {
          console.error(
            "Failed to revoke GitHub token:",
            response.status,
            response.statusText,
          );
        }
      } catch (error) {
        console.error("Error revoking GitHub token:", error);
      }
    }

    // Delete the GitHub account from our database completely
    await db.account.delete({
      where: {
        id: account.id,
      },
    });

    // Also delete the GitHub auth data
    await db.gitHubAuth.deleteMany({
      where: {
        userId: userId,
      },
    });

    // Delete all sessions for this user to force complete re-authentication
    // Use try-catch to handle cases where sessions might already be deleted
    try {
      await db.session.deleteMany({
        where: {
          userId: userId,
        },
      });
    } catch (error) {
      console.error(
        "Sessions already deleted or error deleting sessions:",
        error,
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revoking GitHub access:", error);
    return NextResponse.json(
      { error: "Failed to revoke GitHub access" },
      { status: 500 },
    );
  }
}
