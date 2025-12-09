import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

// Mock Jarvis endpoint response for voice embedding generation
async function generateVoiceEmbedding(
  audioData?: string,
  callRefId?: string,
  startTimestamp?: number,
  endTimestamp?: number
): Promise<number[]> {
  // Placeholder: In production, this would call the actual Jarvis API
  // POST to Jarvis /voice/enroll endpoint with audio data or call reference
  
  // For now, return a mock embedding vector (128-dimensional)
  return Array.from({ length: 128 }, () => Math.random());
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { audioBlob, callRefId, startTimestamp, endTimestamp } = body;

    // Validate input: either audioBlob or callRefId must be provided
    if (!audioBlob && !callRefId) {
      return NextResponse.json(
        { error: "Either audioBlob or callRefId must be provided" },
        { status: 400 }
      );
    }

    if (callRefId && (startTimestamp === undefined || endTimestamp === undefined)) {
      return NextResponse.json(
        { error: "startTimestamp and endTimestamp are required when using callRefId" },
        { status: 400 }
      );
    }

    // Generate voice embedding from Jarvis
    const embedding = await generateVoiceEmbedding(
      audioBlob,
      callRefId,
      startTimestamp,
      endTimestamp
    );

    // Encrypt the voice embedding
    const encryptionService = EncryptionService.getInstance();
    const encryptedEmbedding = JSON.stringify(
      encryptionService.encryptField(
        "voiceEmbedding",
        JSON.stringify(embedding)
      )
    );

    // Upsert voice signature in database
    const voiceSignature = await db.voiceSignature.upsert({
      where: {
        userId: session.user.id,
      },
      update: {
        voiceEmbedding: encryptedEmbedding,
        sampleCount: {
          increment: 1,
        },
        lastUpdatedAt: new Date(),
      },
      create: {
        userId: session.user.id,
        voiceEmbedding: encryptedEmbedding,
        sampleCount: 1,
      },
    });

    return NextResponse.json({
      success: true,
      voiceSignature: {
        id: voiceSignature.id,
        sampleCount: voiceSignature.sampleCount,
        lastUpdatedAt: voiceSignature.lastUpdatedAt,
        createdAt: voiceSignature.createdAt,
      },
    });
  } catch (error) {
    console.error("Error enrolling voice signature:", error);
    return NextResponse.json(
      { error: "Failed to enroll voice signature" },
      { status: 500 }
    );
  }
}
