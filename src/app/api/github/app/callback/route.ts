import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  getAppInstallations,
  getInstallationRepositories,
} from "@/lib/github-app";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const installationId = searchParams.get("installation_id");

    if (installationId) {
      // User just installed the app, return the installation details
      try {
        const installations = await getAppInstallations();
        const installation = installations.find(
          (inst) => inst.id === parseInt(installationId),
        );

        if (!installation) {
          return NextResponse.json(
            { error: "Installation not found" },
            { status: 404 },
          );
        }

        // Get repositories for this installation
        const repositories = await getInstallationRepositories(installation.id);

        return NextResponse.json({
          success: true,
          installation,
          repositories,
          message: "GitHub App installed successfully",
        });
      } catch (error) {
        console.error("Error fetching installation details:", error);
        return NextResponse.json(
          { error: "Failed to fetch installation details" },
          { status: 500 },
        );
      }
    }

    // No installation_id, just return all installations for this user
    try {
      const installations = await getAppInstallations();
      return NextResponse.json({
        success: true,
        installations,
      });
    } catch (error) {
      console.error("Error fetching installations:", error);
      return NextResponse.json(
        { error: "Failed to fetch installations" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error in GitHub App callback:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
