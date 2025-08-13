import { authOptions } from "@/lib/auth/nextauth";
import { getServiceConfig } from "@/services";
import { SwarmService } from "@/services/swarm";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.id) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 },
            );
        }

        const { searchParams } = new URL(request.url);
        const uri = searchParams.get("uri");


        if (!uri) {
            return NextResponse.json(
                { success: false, message: "Provide url please" },
                { status: 404 },
            );
        }

        const swarmConfig = getServiceConfig("swarm");
        const swarmService = new SwarmService(swarmConfig);

        const apiResult = await swarmService.validateUri(uri);


        return NextResponse.json(
            {
                success: apiResult.success,
                message: apiResult.message,
                data: apiResult.data,
            },
            { status: 200 },
        );
    } catch {
        return NextResponse.json(
            { success: false, message: "Failed to validate uri" },
            { status: 500 },
        );
    }
}
