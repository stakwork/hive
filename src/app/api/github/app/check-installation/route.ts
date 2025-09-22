import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { getUserAppTokens } from "@/lib/githubApp";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const owner = searchParams.get("owner");

    if (!owner) {
      return NextResponse.json({ error: "Owner parameter is required" }, { status: 400 });
    }

    console.log(`🔍 Checking GitHub app installation for owner: ${owner}`);

    // Get user's app tokens to make authenticated requests
    const appTokens = await getUserAppTokens(session.user.id);
    if (!appTokens?.accessToken) {
      console.log(`❌ No app tokens found for user ${session.user.id}`);
      return NextResponse.json({ installed: false }, { status: 200 });
    }

    // Try to determine if owner is a user or org by checking user endpoint first
    let isUser = false;
    let isOrg = false;

    try {
      const userResponse = await fetch(`https://api.github.com/users/${owner}`, {
        headers: {
          Authorization: `Bearer ${appTokens.accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (userResponse.ok) {
        const userData = await userResponse.json();
        isUser = userData.type === "User";
        isOrg = userData.type === "Organization";
        console.log(`📋 ${owner} is a ${userData.type}`);
      }
    } catch (err) {
      console.error(`Error checking user/org type for ${owner}:`, err);
    }

    // Check installation based on type
    let installationResponse;

    if (isOrg) {
      console.log(`🏢 Checking org installation for ${owner}`);
      installationResponse = await fetch(`https://api.github.com/orgs/${owner}/installation`, {
        headers: {
          Authorization: `Bearer ${appTokens.accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
    } else if (isUser) {
      console.log(`👤 Checking user installation for ${owner}`);
      installationResponse = await fetch(`https://api.github.com/users/${owner}/installation`, {
        headers: {
          Authorization: `Bearer ${appTokens.accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      });
    } else {
      console.log(`❓ Could not determine type for ${owner}, defaulting to not installed`);
      return NextResponse.json({ installed: false }, { status: 200 });
    }

    if (installationResponse?.ok) {
      const installationData = await installationResponse.json();
      console.log(`✅ App installed on ${owner}! Installation ID: ${installationData.id}`);

      return NextResponse.json({
        installed: true,
        installationId: installationData.id,
        type: isUser ? "user" : "org",
      }, { status: 200 });
    } else {
      const status = installationResponse?.status;
      console.log(`❌ App not installed on ${owner} (status: ${status})`);

      return NextResponse.json({
        installed: false,
        type: isUser ? "user" : "org",
      }, { status: 200 });
    }

  } catch (error) {
    console.error("Failed to check GitHub App installation", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}