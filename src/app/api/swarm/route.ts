import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { SwarmService } from "@/services/swarm";
import { getServiceConfig } from "@/config/services";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { SwarmStatus } from "@prisma/client";
import {
    SWARM_DEFAULT_INSTANCE_TYPE,
    SWARM_DEFAULT_ENV_VARS,
    getSwarmVanityAddress,
} from "@/lib/constants";
import { isFakeMode, createFakeSwarm } from "@/services/swarm/fake";

export async function POST(request: NextRequest) {
    if (isFakeMode) {
        const { id, swarm_id } = await createFakeSwarm();
        return NextResponse.json({
            success: true,
            message: "Swarm (FAKE) was created successfully",
            data: { id, swarm_id },
        });
    }
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json();

        const { workspaceId, name } = body;

        // Validate required fields
        if (!workspaceId || !name) {
            return NextResponse.json(
                {
                    success: false,
                    message: "Missing required fields: workspaceId, name",
                },
                { status: 400 }
            );
        }

        const vanity_address = getSwarmVanityAddress(name);
        const instance_type = SWARM_DEFAULT_INSTANCE_TYPE;
        const env = SWARM_DEFAULT_ENV_VARS;

        // Save or update Swarm in the database (status: PENDING)
        await saveOrUpdateSwarm({
            workspaceId,
            name: vanity_address, // domain name used for creation
            instanceType: instance_type,
            environmentVariables: {},
            status: SwarmStatus.PENDING,
        });

        // Trigger the 3rd party request
        const swarmConfig = getServiceConfig("swarm");
        const swarmService = new SwarmService(swarmConfig);

        // Append '-swarm' to the name for the 3rd party request
        const thirdPartyName = `${name.toLowerCase()}-Swarm`;
        const apiResponse = await swarmService.createSwarm({
            vanity_address,
            name: thirdPartyName,
            instance_type,
            env,
        });

        // Always update the swarm with returned swarm_id, keep status PENDING
        const swarm_id = apiResponse?.data?.swarm_id;
        const updatedSwarm = await saveOrUpdateSwarm({
            workspaceId,
            swarmUrl: `https://${vanity_address}/api`,
            status: SwarmStatus.PENDING,
            swarmId: swarm_id,
        });

        return NextResponse.json({
            success: true,
            message: `${name}-Swarm was created successfully`,
            data: { id: updatedSwarm.id, swarm_id },
        });
    } catch (error) {
        console.error("Error creating Swarm:", error);
        return NextResponse.json(
            { success: false, message: "Failed to create swarm" },
            { status: 500 }
        );
    }
}
