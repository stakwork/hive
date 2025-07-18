import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions, getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { RepositoryStatus } from "@prisma/client";

export async function POST(request: NextRequest) {
    console.log("..............INGEST API BEING CALLED............");

    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { repo_url, workspaceId, swarmId, use_lsp, commit } = body;

        if (!swarmId) {
            return NextResponse.json(
                { success: false, message: "Missing required fields: swarmId" },
                { status: 400 }
            );
        }

        // Get user's GitHub username and PAT using the reusable utility
        const githubCreds = await getGithubUsernameAndPAT(session.user.id);
        if (!githubCreds) {
            return NextResponse.json(
                {
                    success: false,
                    message: "No GitHub credentials found for user",
                },
                { status: 400 }
            );
        }
        const { username, pat } = githubCreds;

        // Resolve Swarm
        const where: Record<string, string> = {};
        if (swarmId) where.swarmId = swarmId;
        if (!swarmId && workspaceId) where.workspaceId = workspaceId;
        const swarm = await db.swarm.findFirst({ where });
        if (!swarm) {
            return NextResponse.json(
                { success: false, message: "Swarm not found" },
                { status: 404 }
            );
        }
        if (!swarm.swarmUrl || !swarm.swarmApiKey) {
            return NextResponse.json(
                { success: false, message: "Swarm URL or API key not set" },
                { status: 400 }
            );
        }

        // Confirm repo_url association (for now, check repositoryUrl field)
        // if (swarm.repositoryUrl !== repo_url) {
        //   return NextResponse.json({ success: false, message: 'Swarm is not associated with the given repo_url' }, { status: 400 });
        // }

        // Determine workspaceId for repository
        const repoWorkspaceId = workspaceId || swarm.workspaceId;

        console.log("*************");
        console.log(swarm);

        //const final_repo_url =
        //    repo_url || swarm.wizardData?.selectedRepo?.html_url;
        let final_repo_url;
        interface WizardData {
            selectedRepo?: { html_url?: string };
        }
        if (
            swarm.wizardData &&
            typeof swarm.wizardData === "object" &&
            "selectedRepo" in swarm.wizardData
        ) {
            final_repo_url =
                repo_url ||
                (swarm.wizardData as WizardData).selectedRepo?.html_url;
        }

        // Upsert Repository record with status PENDING
        const repository = await db.repository.upsert({
            where: {
                repositoryUrl_workspaceId: {
                    repositoryUrl: final_repo_url,
                    workspaceId: repoWorkspaceId,
                },
            },
            update: { status: RepositoryStatus.PENDING },
            create: {
                name: final_repo_url.split("/").pop() || final_repo_url,
                repositoryUrl: final_repo_url,
                workspaceId: repoWorkspaceId,
                status: RepositoryStatus.PENDING,
            },
        });

        const dataApi = {
            repo_url: final_repo_url,
            username,
            pat,
            use_lsp: null,
            commit: null,
        };

        if (use_lsp) {
            dataApi["use_lsp"] = use_lsp;
        }

        if (commit) {
            dataApi["commit"] = commit;
        }

        console.log("dataApi", dataApi);

        const stakgraphUrl = `https://stakgraph.${swarm.name}`;

        console.log(">>>>>>>>.stakgraphUrl", stakgraphUrl);

        // Proxy to stakgraph microservice
        const apiResult = await swarmApiRequest({
            swarmUrl: stakgraphUrl,
            endpoint: "/ingest",
            method: "POST",
            apiKey: swarm.swarmApiKey,
            data: dataApi,
        });

        console.log("apiResult", apiResult);

        // If success, update repository status to SYNCED
        let finalStatus = repository.status;
        if (
            apiResult.ok &&
            apiResult.data &&
            typeof apiResult.data === "object" &&
            "status" in apiResult.data &&
            apiResult.data.status === "success"
        ) {
            await db.repository.update({
                where: { id: repository.id },
                data: { status: RepositoryStatus.SYNCED },
            });
            finalStatus = RepositoryStatus.SYNCED;
        }

        return NextResponse.json(
            {
                success: apiResult.ok,
                status: apiResult.status,
                data: apiResult.data,
                repositoryStatus: finalStatus,
            },
            { status: apiResult.status }
        );
    } catch {
        return NextResponse.json(
            { success: false, message: "Failed to ingest code" },
            { status: 500 }
        );
    }
}
