import { NextRequest } from "next/server";
import { z } from "zod";
import { getOrCreateJanitorConfig, updateJanitorConfig } from "@/services/janitor";
import {
  withAuth,
  createApiResponse,
  handleApiError,
  validationError,
  notFoundError,
  forbiddenError,
} from "@/lib/utils/api-response";

const updateJanitorConfigSchema = z.object({
  unitTestsEnabled: z.boolean().optional(),
  integrationTestsEnabled: z.boolean().optional(),
  e2eTestsEnabled: z.boolean().optional(),
  securityReviewEnabled: z.boolean().optional(),
  mockGenerationEnabled: z.boolean().optional(),
  generalRefactoringEnabled: z.boolean().optional(),
  taskCoordinatorEnabled: z.boolean().optional(),
  recommendationSweepEnabled: z.boolean().optional(),
  ticketSweepEnabled: z.boolean().optional(),
});

export const GET = withAuth(async (request, context, user, params) => {
  try {
    const { slug } = params as { slug: string };
    const config = await getOrCreateJanitorConfig(slug, user.id);

    return createApiResponse({ config });
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return handleApiError(
        notFoundError("Workspace not found or access denied"),
        context.requestId
      );
    }
    return handleApiError(error, context.requestId);
  }
});

export const PUT = withAuth(async (request, context, user, params) => {
  try {
    const { slug } = params as { slug: string };
    const body = await request.json();

    // Validate request body
    const parseResult = updateJanitorConfigSchema.safeParse(body);
    if (!parseResult.success) {
      return handleApiError(
        validationError("Validation failed", parseResult.error.issues),
        context.requestId
      );
    }

    const validatedData = parseResult.data;
    const config = await updateJanitorConfig(slug, user.id, validatedData);

    return createApiResponse({ config });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return handleApiError(
          notFoundError("Workspace not found or access denied"),
          context.requestId
        );
      }
      if (error.message.includes("Insufficient permissions")) {
        return handleApiError(
          forbiddenError("Insufficient permissions"),
          context.requestId
        );
      }
    }
    return handleApiError(error, context.requestId);
  }
});
