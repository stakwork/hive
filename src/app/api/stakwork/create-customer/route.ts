import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { stakworkService } from "@/lib/service-factory";
import { type ApiError } from "@/types";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

export const runtime = "nodejs";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId } = body;

    const customerResponse =
      await stakworkService().createCustomer(workspaceId);

    // Defensive: check for expected shape, fallback to empty object if not
    const data =
      customerResponse &&
      typeof customerResponse === "object" &&
      "data" in customerResponse
        ? (customerResponse as { data?: { token?: string } }).data
        : undefined;

    if (data && typeof data === "object" && "token" in data) {
      const { token } = data;

      const workspace = await db.workspace.findFirst({
        where: { id: workspaceId, deleted: false },
      });

      if (workspace) {
        const encryptedStakworkApiKey = encryptionService.encryptField(
          "stakworkApiKey",
          token || "",
        );
        await db.workspace.update({
          where: { id: workspace.id },
          data: {
            stakworkApiKey: JSON.stringify(encryptedStakworkApiKey),
          },
        });
      }

      const swarm = await db.swarm.findFirst({
        where: {
          workspaceId: workspace?.id || "",
        },
      });

      const sanitizedSecretAlias = (swarm?.swarmSecretAlias || "").replace(
        /{{(.*?)}}/g,
        "$1",
      );
      const decryptedSwarmApiKey = encryptionService.decryptField(
        "swarmApiKey",
        swarm?.swarmApiKey || "",
      );

      if (sanitizedSecretAlias && swarm?.swarmApiKey && token) {
        await stakworkService().createSecret(
          sanitizedSecretAlias,
          decryptedSwarmApiKey,
          token,
        );
      }

      return NextResponse.json({ token }, { status: 201 });
    }
  } catch (error) {
    console.error("Error creating Stakwork customer:", error);

    // Handle ApiError specifically
    if (error && typeof error === "object" && "status" in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details,
        },
        { status: apiError.status },
      );
    }

    return NextResponse.json(
      { error: "Failed to create customer" },
      { status: 500 },
    );
  }
}
