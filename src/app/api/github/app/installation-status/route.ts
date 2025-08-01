import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  getRepositoryInstallationInfo,
  generateInstallationUrlForRepository,
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

    // Check if the repository is installed with detailed info
    const installationInfo =
      await getRepositoryInstallationInfo(repositoryFullName);

    // Generate installation URL for this repository
    const installationUrl = generateInstallationUrlForRepository(
      repositoryFullName,
      installationInfo.needsUserInstallation,
    );

    return NextResponse.json({
      installed: installationInfo.installed,
      installationId: installationInfo.installationId,
      installationUrl,
      repository: repositoryFullName,
      accountType: installationInfo.accountType,
      accountLogin: installationInfo.accountLogin,
      repositoryOwner: installationInfo.repositoryOwner,
      needsUserInstallation: installationInfo.needsUserInstallation,
      availableInstallations: installationInfo.availableInstallations,
    });
  } catch (error) {
    console.error("Error checking GitHub App installation:", error);
    return NextResponse.json(
      { error: "Failed to check installation status" },
      { status: 500 },
    );
  }
}
