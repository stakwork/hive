import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { swarmApiRequest } from "@/services/swarm/api/swarm";

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { workspaceId, swarmId } = body;
        if (!workspaceId && !swarmId) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Missing required fields: workspaceId or swarmId",
                },
                { status: 400 }
            );
        }

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

        // Proxy to stakgraph microservice
        const apiResult = await swarmApiRequest({
            swarmUrl: `https://repo2graph.${swarm.name}.sphinx.chat`,
            endpoint: "/services",
            method: "GET",
            apiKey: swarm.swarmApiKey,
        });

        return NextResponse.json(
            {
                success: apiResult.ok,
                status: apiResult.status,
                data: apiResult.data,
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
