import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getPodDetails, POD_PORTS, buildPodUrl } from "@/lib/pods";
import { releaseTaskPod } from "@/lib/pods/utils";
import { getUserAppTokens } from "@/lib/githubApp";
import { generateCommitMessage } from "@/lib/ai/commit-msg";
import { TaskStatus } from "@prisma/client";

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
    }

    const { taskId } = await params;

    // Fetch task with pod, repository, and workspace repositories
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        podId: true,
        repository: {
          select: {
            repositoryUrl: true,
            branch: true,
            name: true,
          },
        },
        workspace: {
          select: {
            id: true,
            ownerId: true,
            members: {
              select: { userId: true },
            },
            repositories: {
              select: {
                repositoryUrl: true,
                branch: true,
                name: true,
              },
            },
            sourceControlOrg: {
              select: { githubLogin: true },
            },
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const { workspace } = task;

    // Auth check: must be owner or member
    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.some((m) => m.userId === userId);
    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Must have a pod
    if (!task.podId) {
      return NextResponse.json({ error: "No pod assigned to this task" }, { status: 400 });
    }

    // Resolve repository: task's own repo, or first workspace repo
    const repo = task.repository ?? workspace.repositories[0];
    if (!repo) {
      return NextResponse.json({ error: "No repository found for this task" }, { status: 400 });
    }

    // Generate AI commit message + branch name
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("host");
    const baseUrl = host ? `${protocol}://${host}` : undefined;

    const { commit_message: commitMessage, branch_name: branchName } = await generateCommitMessage(
      taskId,
      baseUrl,
      undefined,
    );

    // Get pod details (password + port mappings)
    const podDetails = await getPodDetails(task.podId);
    if (!podDetails) {
      return NextResponse.json({ error: "Pod not found" }, { status: 404 });
    }

    const { podId: podIdentifier, password } = podDetails;
    if (!password) {
      return NextResponse.json({ error: "Pod password not found" }, { status: 500 });
    }

    // Get GitHub access token
    const githubOwner = workspace.sourceControlOrg?.githubLogin;
    const tokens = await getUserAppTokens(userId, githubOwner);
    if (!tokens?.accessToken) {
      return NextResponse.json(
        { error: "GitHub token not found. Please reconnect your GitHub account." },
        { status: 401 },
      );
    }

    const controlPortUrl = buildPodUrl(podIdentifier, POD_PORTS.CONTROL);
    const pushUrl = `${controlPortUrl}/push?commit=true&pr=false`;

    const pushPayload = {
      tasks: [],
      repos: [
        {
          url: repo.repositoryUrl,
          hash: "",
          commit_name: commitMessage,
          branch_name: branchName,
          base_branch: repo.branch,
        },
      ],
      git_credentials: {
        provider: "github",
        auth_type: "app",
        auth_data: {
          token: tokens.accessToken,
        },
      },
    };

    const pushResponse = await fetch(pushUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${password}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pushPayload),
    });

    if (!pushResponse.ok) {
      const errorText = await pushResponse.text();
      return NextResponse.json(
        { error: `Failed to push: ${pushResponse.status}`, details: errorText },
        { status: pushResponse.status },
      );
    }

    const pushData = await pushResponse.json();

    // Extract branch name from branches map
    const resolvedBranchName: string =
      pushData.branches?.[repo.name] ??
      (pushData.branches ? Object.values(pushData.branches)[0] : branchName) ??
      branchName;

    // Mark task DONE and release pod (best-effort — does not block response)
    await Promise.allSettled([
      db.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.DONE },
      }),
      releaseTaskPod({
        taskId,
        podId: task.podId,
        workspaceId: workspace.id,
        verifyOwnership: false,
        clearTaskFields: true,
        newWorkflowStatus: "COMPLETED",
      }),
    ]);

    return NextResponse.json(
      { success: true, branchName: resolvedBranchName, commitMessage },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in prototype push:", error);
    return NextResponse.json({ error: "Failed to push prototype branch" }, { status: 500 });
  }
}
