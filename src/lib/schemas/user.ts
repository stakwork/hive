import { z } from 'zod'

export const voiceSignatureUploadRequestSchema = z.object({
  contentType: z.literal('audio/wav'),
  size: z.number().min(1).max(50 * 1024 * 1024), // 50 MB max
})

export const voiceSignatureConfirmSchema = z.object({
  s3Path: z.string().min(1),
})

export type VoiceSignatureUploadRequest = z.infer<typeof voiceSignatureUploadRequestSchema>
export type VoiceSignatureConfirm = z.infer<typeof voiceSignatureConfirmSchema>
