import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { poolManagerService } from "@/lib/service-factory";
import { type ApiError } from "@/types";

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json();
        const {
            pool_name,
            minimum_vms,
            repo_name,
            branch_name,
            github_pat,
            github_username,
            env_vars,
        } = body;

        // Validate required fields
        if (!pool_name) {
            return NextResponse.json(
                { error: "Missing required field: name" },
                { status: 400 }
            );
        }

        const pool = await poolManagerService().createPool({
            pool_name,
            minimum_vms,
            repo_name,
            branch_name,
            github_pat,
            github_username,
            env_vars,
        });

        return NextResponse.json({ pool }, { status: 201 });
    } catch (error) {
        console.error("Error creating Pool Manager pool:", error);

        // Handle ApiError specifically
        if (error && typeof error === "object" && "status" in error) {
            const apiError = error as ApiError;
            return NextResponse.json(
                {
                    error: apiError.message,
                    service: apiError.service,
                    details: apiError.details,
                },
                { status: apiError.status }
            );
        }

        return NextResponse.json(
            { error: "Failed to create pool" },
            { status: 500 }
        );
    }
}
