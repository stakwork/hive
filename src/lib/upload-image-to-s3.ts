/**
 * Client-side utility for uploading image files to S3 via presigned URLs.
 * Note: src/lib/screenshot-upload.ts is server-side (Node.js) — do not use it on the client.
 */

export interface UploadedFileResult {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

export async function uploadFileToS3(
  file: File,
  context: { featureId: string } | { taskId: string } | { workspaceId: string } | { orgId: string },
): Promise<UploadedFileResult> {
  let endpoint: string;
  let body: Record<string, unknown>;

  if ("featureId" in context) {
    endpoint = "/api/upload/image";
    body = {
      featureId: context.featureId,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    };
  } else if ("orgId" in context) {
    endpoint = "/api/upload/presigned-url";
    body = {
      orgId: context.orgId,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    };
  } else if ("workspaceId" in context) {
    endpoint = "/api/upload/presigned-url";
    body = {
      workspaceId: context.workspaceId,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    };
  } else {
    endpoint = "/api/upload/presigned-url";
    body = {
      taskId: context.taskId,
      filename: file.name,
      contentType: file.type,
      size: file.size,
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || "Failed to get upload URL");
  }

  const { presignedUrl, s3Path } = await response.json();

  const s3Response = await fetch(presignedUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });

  if (!s3Response.ok) {
    throw new Error("Failed to upload file to S3");
  }

  return {
    path: s3Path,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
  };
}
