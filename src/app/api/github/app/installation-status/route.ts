import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  isRepositoryInstalled,
  generateInstallationUrl,
} from "@/lib/github-app";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const repositoryFullName = searchParams.get("repository");

    if (!repositoryFullName) {
      return NextResponse.json(
        { error: "Repository parameter is required" },
        { status: 400 },
      );
    }

    // Check if the repository is installed
    const installationStatus = await isRepositoryInstalled(repositoryFullName);

    // Generate installation URL for this repository
    const installationUrl = generateInstallationUrl(repositoryFullName);

    return NextResponse.json({
      installed: installationStatus.installed,
      installationId: installationStatus.installationId,
      installationUrl,
      repository: repositoryFullName,
    });
  } catch (error) {
    console.error("Error checking GitHub App installation:", error);
    return NextResponse.json(
      { error: "Failed to check installation status" },
      { status: 500 },
    );
  }
}
