import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { stakworkService } from "@/lib/service-factory";
import { type ApiError } from "@/types";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

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
      let decryptedSwarmApiKey = encryptionService.decryptField(
        "swarmApiKey",
        swarm?.swarmApiKey || "",
      );
      try {
        const maybeEncryptedAgain = JSON.parse(decryptedSwarmApiKey);
        if (
          maybeEncryptedAgain &&
          typeof maybeEncryptedAgain === "object" &&
          "data" in maybeEncryptedAgain &&
          "iv" in maybeEncryptedAgain &&
          "tag" in maybeEncryptedAgain
        ) {
          decryptedSwarmApiKey = encryptionService.decryptField(
            "swarmApiKey",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            maybeEncryptedAgain as any,
          );
        }
      } catch { }

      if (sanitizedSecretAlias && swarm?.swarmApiKey && token) {
        await stakworkService().createSecret(
          sanitizedSecretAlias,
          decryptedSwarmApiKey,
          token,
        );
      }

      return NextResponse.json({ success: true }, { status: 201 });
    }

    // If we don't have a valid token in the response
    return NextResponse.json(
      { error: "Invalid response from Stakwork API" },
      { status: 500 }
    );
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
