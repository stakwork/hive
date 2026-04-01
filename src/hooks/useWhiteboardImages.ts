import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";

export interface StoredFileEntry {
  id: string; // FileId as plain string (serialized to DB)
  s3Key: string;
  mimeType: string;
  created: number;
}

/**
 * Upload any new images (with base64 dataURL) to S3.
 * Entries that already have an s3Key pass through unchanged.
 * Returns a cleaned files map with no raw dataURLs.
 */
export async function uploadNewFiles(
  whiteboardId: string,
  files: BinaryFiles
): Promise<Record<string, StoredFileEntry>> {
  const result: Record<string, StoredFileEntry> = {};

  await Promise.all(
    Object.entries(files).map(async ([fileId, fileData]) => {
      const entry = fileData as BinaryFileData & { s3Key?: string };

      // Already uploaded — pass through
      if (entry.s3Key) {
        result[fileId] = {
          id: entry.id as FileId,
          s3Key: entry.s3Key,
          mimeType: entry.mimeType as string,
          created: entry.created ?? Date.now(),
        };
        return;
      }

      // New image with base64 dataURL — upload to S3
      const dataURL = entry.dataURL as string | undefined;
      if (!dataURL?.startsWith("data:")) {
        return; // skip entries without a usable dataURL
      }

      try {
        // Get a presigned upload URL
        const uploadRes = await fetch(`/api/whiteboards/${whiteboardId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId, mimeType: entry.mimeType }),
        });

        if (!uploadRes.ok) {
          console.error("Failed to get presigned URL for whiteboard image", fileId);
          return;
        }

        const { presignedUploadUrl, s3Key } = await uploadRes.json();

        // Decode base64 portion to binary blob
        const [header, base64Data] = dataURL.split(",");
        const mimeMatch = header.match(/data:([^;]+);/)
        const mimeType = mimeMatch?.[1] ?? (entry.mimeType as string);
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });

        // Upload to S3
        const s3Res = await fetch(presignedUploadUrl, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": mimeType },
        });

        if (!s3Res.ok) {
          console.error("Failed to upload whiteboard image to S3", fileId);
          return;
        }

        result[fileId] = {
          id: entry.id as FileId,
          s3Key,
          mimeType: mimeType,
          created: entry.created ?? Date.now(),
        };
      } catch (err) {
        console.error("Error uploading whiteboard image", fileId, err);
      }
    })
  );

  return result;
}

/**
 * Resolve stored file entries to BinaryFiles with presigned download URLs.
 * Legacy entries that already have a dataURL pass through unchanged (backward compat).
 * Entries with s3Key get a fresh presigned URL from the API.
 */
export async function resolveFilesForDisplay(
  whiteboardId: string,
  storedFiles: Record<string, unknown>
): Promise<BinaryFiles> {
  const result: BinaryFiles = {};

  const s3FileIds: string[] = [];
  const legacyEntries: Array<{ fileId: string; entry: Record<string, unknown> }> = [];

  for (const [fileId, raw] of Object.entries(storedFiles)) {
    const entry = raw as Record<string, unknown>;
    if (entry.s3Key) {
      s3FileIds.push(fileId);
    } else if (entry.dataURL) {
      // Legacy base64 entry — pass through as-is
      legacyEntries.push({ fileId, entry });
    }
  }

  // Include legacy entries directly
  for (const { fileId, entry } of legacyEntries) {
    result[fileId] = {
      id: ((entry.id as string) ?? fileId) as FileId,
      dataURL: entry.dataURL as BinaryFileData["dataURL"],
      mimeType: entry.mimeType as BinaryFileData["mimeType"],
      created: (entry.created as number) ?? Date.now(),
    };
  }

  if (s3FileIds.length === 0) return result;

  try {
    const res = await fetch(
      `/api/whiteboards/${whiteboardId}/images?fileIds=${s3FileIds.join(",")}`
    );

    if (!res.ok) {
      console.error("Failed to fetch presigned download URLs for whiteboard images");
      return result;
    }

    const resolved: Record<string, { presignedDownloadUrl: string; mimeType: string }> =
      await res.json();

    for (const fileId of s3FileIds) {
      const data = resolved[fileId];
      if (!data) continue; // S3 key missing — skip (broken image placeholder)

      const storedEntry = storedFiles[fileId] as Record<string, unknown>;
      result[fileId] = {
        id: ((storedEntry.id as string) ?? fileId) as FileId,
        dataURL: data.presignedDownloadUrl as BinaryFileData["dataURL"],
        mimeType: data.mimeType as BinaryFileData["mimeType"],
        created: (storedEntry.created as number) ?? Date.now(),
      };
    }
  } catch (err) {
    console.error("Error resolving whiteboard image URLs:", err);
  }

  return result;
}
