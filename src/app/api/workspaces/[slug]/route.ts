import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import {
  getWorkspaceBySlug,
  deleteWorkspaceBySlug,
  updateWorkspace,
} from "@/services/workspace";
import { updateWorkspaceSchema } from "@/lib/schemas/workspace";
import { unauthorized, badRequest, notFound } from "@/types/errors";
import { handleApiError } from "@/lib/api/errors";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      throw unauthorized("Unauthorized");
    }

    const { slug } = await params;

    if (!slug) {
      throw badRequest("Workspace slug is required");
    }

    const workspace = await getWorkspaceBySlug(slug, userId);

    if (!workspace) {
      throw notFound("Workspace not found or access denied");
    }

    return NextResponse.json({ workspace });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const session = await getServerSession(authOptions);

    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      throw unauthorized("Unauthorized");
    }

    const { slug } = await params;

    if (!slug) {
      throw badRequest("Workspace slug is required");
    }

    await deleteWorkspaceBySlug(slug, userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);

    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      throw unauthorized("Unauthorized");
    }

    const { slug } = await params;

    if (!slug) {
      throw badRequest("Workspace slug is required");
    }

    // Parse and validate request body
    const body = await request.json();
    const validatedData = updateWorkspaceSchema.parse(body);

    // Update the workspace
    const updatedWorkspace = await updateWorkspace(slug, userId, validatedData);

    return NextResponse.json({
      workspace: updatedWorkspace,
      // Include the new slug if it changed for client-side redirect
      slugChanged: validatedData.slug !== slug ? validatedData.slug : null,
    });
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      return handleApiError(badRequest("Validation failed", error.issues));
    }
    return handleApiError(error);
  }
}
