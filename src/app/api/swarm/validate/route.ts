import { getServiceConfig } from "@/services";
import { SwarmService } from "@/services/swarm";
import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";

export async function GET(request: NextRequest): Promise<NextResponse> {
    try {
        const context = getMiddlewareContext(request);
        const userOrResponse = requireAuth(context);
        if (userOrResponse instanceof NextResponse) return userOrResponse;

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
