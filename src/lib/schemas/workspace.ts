import { z } from "zod";
import { WORKSPACE_SLUG_PATTERNS, RESERVED_WORKSPACE_SLUGS, WORKSPACE_ERRORS } from "@/lib/constants";

export const updateWorkspaceSchema = z.object({
  name: z
    .string()
    .min(1, "Workspace name is required")
    .max(100, "Workspace name must be 100 characters or less")
    .trim(),

  slug: z
    .string()
    .trim()
    .min(WORKSPACE_SLUG_PATTERNS.MIN_LENGTH, WORKSPACE_ERRORS.SLUG_INVALID_LENGTH)
    .max(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH, WORKSPACE_ERRORS.SLUG_INVALID_LENGTH)
    .regex(WORKSPACE_SLUG_PATTERNS.VALID, WORKSPACE_ERRORS.SLUG_INVALID_FORMAT)
    .refine(
      (val) => !RESERVED_WORKSPACE_SLUGS.includes(val as (typeof RESERVED_WORKSPACE_SLUGS)[number]),
      WORKSPACE_ERRORS.SLUG_RESERVED,
    )
    .transform((val) => val.toLowerCase()),

  description: z
    .string()
    .max(500, "Description must be 500 characters or less")
    .transform((val) => (val === "" ? undefined : val))
    .optional(),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

export const workspaceLogoUploadRequestSchema = z.object({
  filename: z.string().min(1, "Filename is required"),
  contentType: z.string().min(1, "Content type is required"),
  size: z
    .number()
    .min(1, "File size must be greater than 0")
    .max(1024 * 1024, "File size must not exceed 1MB"),
});

export const workspaceLogoConfirmSchema = z.object({
  s3Path: z.string().min(1, "S3 path is required"),
  filename: z.string().min(1, "Filename is required"),
  mimeType: z.string().min(1, "MIME type is required"),
  size: z.number().min(1, "File size must be greater than 0"),
});

export type WorkspaceLogoUploadRequest = z.infer<typeof workspaceLogoUploadRequestSchema>;
export type WorkspaceLogoConfirm = z.infer<typeof workspaceLogoConfirmSchema>;
