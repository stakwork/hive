import { getS3Service } from '@/services/s3'

export interface UploadDiagramResponse {
  s3Key: string
  s3Url: string
}

/**
 * Service for managing diagram storage in S3
 */
export class DiagramStorageService {
  private s3Service = getS3Service()

  /**
   * Generate S3 path for diagram storage
   * @param workspaceId - Workspace identifier
   * @param featureId - Feature identifier
   * @returns S3 key path
   */
  private generateDiagramPath(workspaceId: string, featureId: string): string {
    const timestamp = Date.now()
    return `diagrams/${workspaceId}/${featureId}/${timestamp}.png`
  }

  /**
   * Upload diagram buffer to S3 and return the S3 key and presigned URL
   * @param buffer - PNG image buffer
   * @param featureId - Feature identifier
   * @param workspaceId - Workspace identifier
   * @returns Object containing s3Key and s3Url
   */
  async uploadDiagram(
    buffer: Buffer,
    featureId: string,
    workspaceId: string
  ): Promise<UploadDiagramResponse> {
    const s3Key = this.generateDiagramPath(workspaceId, featureId)

    // Upload to S3
    await this.s3Service.putObject(s3Key, buffer, 'image/png')

    // Generate presigned URL with 7 day expiration (AWS max for presigned URLs)
    const s3Url = await this.s3Service.generatePresignedDownloadUrl(
      s3Key,
      604800
    )

    return {
      s3Key,
      s3Url,
    }
  }

  /**
   * Delete a diagram from S3
   * @param s3Key - S3 object key to delete
   */
  async deleteDiagram(s3Key: string): Promise<void> {
    await this.s3Service.deleteObject(s3Key)
  }
}

// Singleton instance
let _diagramStorageService: DiagramStorageService | null = null

export const getDiagramStorageService = (): DiagramStorageService => {
  if (!_diagramStorageService) {
    _diagramStorageService = new DiagramStorageService()
  }
  return _diagramStorageService
}
