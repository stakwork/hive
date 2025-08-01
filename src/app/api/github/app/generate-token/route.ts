import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  getInstallationAccessToken,
  isRepositoryInstalled,
} from "@/lib/github-app";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { repositoryFullName } = await request.json();

    if (!repositoryFullName) {
      return NextResponse.json(
        { error: "Repository full name is required" },
        { status: 400 },
      );
    }

    // Check if the repository is installed
    const installationStatus = await isRepositoryInstalled(repositoryFullName);

    if (!installationStatus.installed || !installationStatus.installationId) {
      return NextResponse.json(
        {
          error: "Repository is not installed with the GitHub App",
          installed: false,
        },
        { status: 400 },
      );
    }

    // Generate installation access token
    try {
      const accessToken = await getInstallationAccessToken(
        installationStatus.installationId,
      );

      return NextResponse.json({
        success: true,
        accessToken,
        installationId: installationStatus.installationId,
        repository: repositoryFullName,
        expiresIn: 3600, // GitHub App tokens expire after 1 hour
        message: "Installation access token generated successfully",
      });
    } catch (error) {
      console.error("Error generating installation access token:", error);
      return NextResponse.json(
        { error: "Failed to generate installation access token" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error in generate token endpoint:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
