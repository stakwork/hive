import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
});

export async function generatePresignedUrl(
  bucket: string,
  key: string,
  options?: { expiresIn?: number }
): Promise<string> {
  const expiresIn = options?.expiresIn ?? 3600; // default: 1 hour

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });

  console.log('[S3 Presigner] Command:', bucket);

  console.log('[S3 Presigner] Command:', key);

  const url = await getSignedUrl(s3, command, { expiresIn });

  console.log('[S3 Presigner] URL:', url);
  return url;
}

export async function generateCallPresignedUrl(s3Key: string): Promise<string> {
  const bucket = "sphinx-livekit-recordings";
  // Decode URL-encoded S3 key (e.g., %3A becomes :)
  const decodedKey = s3Key;

  console.log('[S3 Presigner] Input key:', s3Key);
  console.log('[S3 Presigner] Decoded key:', decodedKey);
  console.log('[S3 Presigner] Bucket:', bucket);

  try {
    const url = await generatePresignedUrl(bucket, decodedKey);
    console.log('[S3 Presigner] Generated URL successfully');
    return url;
  } catch (error) {
    console.error('[S3 Presigner] Failed to generate URL:', error);
    throw error;
  }
}