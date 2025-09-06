import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/lib/env";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    if (!config.GITHUB_APP_SLUG) {
      return NextResponse.json({ success: false, message: "GitHub App not configured" }, { status: 500 });
    }

    // Generate a secure random state string
    const state = randomBytes(32).toString("hex");

    // Generate the GitHub App installation URL
    const installationUrl = `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new?state=${state}`;

    return NextResponse.json(
      {
        success: true,
        data: {
          link: installationUrl,
          state,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to generate GitHub App installation link", error);
    return NextResponse.json({ success: false, message: "Failed to generate installation link" }, { status: 500 });
  }
}
