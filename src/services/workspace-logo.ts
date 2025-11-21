import { getS3Service } from "@/services/s3";
import { getWorkspaceBySlug } from "@/services/workspace";
import { db } from "@/lib/db";
import type { WorkspaceWithAccess } from "@/types/workspace";
import type { WorkspaceRole } from "@prisma/client";

const ALLOWED_ROLES: WorkspaceRole[] = ["OWNER", "ADMIN"];
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export interface UploadUrlRequest {
  filename: string;
  contentType: string;
  size: number;
}

export interface UploadUrlResponse {
  presignedUrl: string;
  s3Path: string;
  filename: string;
  contentType: string;
  size: number;
  expiresIn: number;
}

export interface ConfirmUploadRequest {
  s3Path: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface ConfirmUploadResponse {
  success: boolean;
  logoKey: string;
  width: number;
  height: number;
  size: number;
}

export class WorkspaceLogoService {
  private s3Service = getS3Service();

  private async validateWorkspaceAccess(
    slug: string,
    userId: string,
    requiredRoles: WorkspaceRole[] = ALLOWED_ROLES,
  ): Promise<WorkspaceWithAccess> {
    const workspace = await getWorkspaceBySlug(slug, userId);

    if (!workspace) {
      throw new Error("Workspace not found or access denied");
    }

    if (!requiredRoles.includes(workspace.userRole)) {
      throw new Error("Insufficient permissions to perform this action");
    }

    return workspace;
  }

  async requestUploadUrl(slug: string, userId: string, request: UploadUrlRequest): Promise<UploadUrlResponse> {
    const workspace = await this.validateWorkspaceAccess(slug, userId);
    const { filename, contentType, size } = request;

    if (!this.s3Service.validateFileType(contentType)) {
      throw new Error("Invalid file type. Only images (JPEG, PNG, GIF, WebP) are allowed.");
    }

    if (!this.s3Service.validateFileSize(size, MAX_FILE_SIZE)) {
      throw new Error("File size exceeds maximum limit of 1MB.");
    }

    const s3Path = this.s3Service.generateWorkspaceLogoPath(workspace.id, filename);

    const presignedUrl = await this.s3Service.generatePresignedUploadUrl(
      s3Path,
      contentType,
      900, // 15 minutes
    );

    return {
      presignedUrl,
      s3Path,
      filename,
      contentType,
      size,
      expiresIn: 900,
    };
  }

  async confirmUpload(
    slug: string,
    userId: string,
    confirmation: ConfirmUploadRequest,
  ): Promise<ConfirmUploadResponse> {
    const { isSupportedImageType, resizeWorkspaceLogo } = await import("@/lib/image-processing");

    const workspace = await this.validateWorkspaceAccess(slug, userId);
    const { s3Path, mimeType } = confirmation;

    if (!isSupportedImageType(mimeType)) {
      throw new Error("Unsupported image type");
    }

    const rawImageBuffer = await this.s3Service.getObject(s3Path);

    if (!this.s3Service.validateImageBuffer(rawImageBuffer, mimeType)) {
      await this.s3Service.deleteObject(s3Path);
      throw new Error("Invalid image file. File content does not match declared type.");
    }

    const processedImage = await resizeWorkspaceLogo(rawImageBuffer);

    await this.s3Service.putObject(s3Path, processedImage.buffer, processedImage.contentType);

    if (workspace.logoKey && workspace.logoKey !== s3Path) {
      try {
        await this.s3Service.deleteObject(workspace.logoKey);
      } catch (error) {
        console.warn("Failed to delete old logo:", error);
      }
    }

    await db.workspace.update({
      where: { id: workspace.id },
      data: {
        logoKey: s3Path,
        updatedAt: new Date(),
      },
    });

    return {
      success: true,
      logoKey: s3Path,
      width: processedImage.width,
      height: processedImage.height,
      size: processedImage.size,
    };
  }

  async getLogoUrl(slug: string, userId: string): Promise<string> {
    const workspace = await getWorkspaceBySlug(slug, userId);

    if (!workspace) {
      throw new Error("Workspace not found or access denied");
    }

    if (!workspace.logoKey) {
      throw new Error("Workspace has no logo");
    }

    return await this.s3Service.generatePresignedDownloadUrl(
      workspace.logoKey,
      3600, // 1 hour
    );
  }

  async removeLogo(slug: string, userId: string): Promise<void> {
    const workspace = await this.validateWorkspaceAccess(slug, userId);

    if (!workspace.logoKey) {
      throw new Error("Workspace has no logo to remove");
    }

    try {
      await this.s3Service.deleteObject(workspace.logoKey);
    } catch (error) {
      console.warn("Failed to delete logo from S3:", error);
    }

    await db.workspace.update({
      where: { id: workspace.id },
      data: {
        logoKey: null,
        logoUrl: null,
        updatedAt: new Date(),
      },
    });
  }
}

let _workspaceLogoService: WorkspaceLogoService | null = null;

export const getWorkspaceLogoService = (): WorkspaceLogoService => {
  if (!_workspaceLogoService) {
    _workspaceLogoService = new WorkspaceLogoService();
  }
  return _workspaceLogoService;
};
