import { NextRequest, NextResponse } from 'next/server';
import { getMiddlewareContext, requireAuth } from '@/lib/middleware/utils';
import { db } from '@/lib/db';
import { generateArchitectureDiagram } from '@/services/gemini-image';
import { getDiagramStorageService } from '@/services/diagram-storage';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const { featureId } = await params;

    // Authenticate user
    const context = getMiddlewareContext(request);
    const user = requireAuth(context);
    if (user instanceof NextResponse) return user;

    // Fetch feature and validate workspace access
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      include: {
        workspace: {
          include: {
            members: {
              where: { userId: user.id },
            },
          },
        },
      },
    });

    if (!feature) {
      return NextResponse.json(
        { error: 'Feature not found' },
        { status: 404 }
      );
    }

    // Check workspace access
    if (feature.workspace.members.length === 0) {
      return NextResponse.json(
        { error: 'Unauthorized: You do not have access to this workspace' },
        { status: 403 }
      );
    }

    // Validate architecture field exists and is not empty
    if (!feature.architecture || feature.architecture.trim() === '') {
      return NextResponse.json(
        { error: 'Architecture text is required for diagram generation' },
        { status: 400 }
      );
    }

    // Generate diagram using Gemini service
    let diagramBuffer: Buffer;
    try {
      diagramBuffer = await generateArchitectureDiagram(feature.architecture);
    } catch (error) {
      console.error('Diagram generation failed:', error);
      return NextResponse.json(
        {
          error: 'Failed to generate diagram',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    // Upload diagram to S3
    let uploadResult: { s3Key: string; s3Url: string };
    try {
      const diagramStorage = getDiagramStorageService();
      uploadResult = await diagramStorage.uploadDiagram(
        diagramBuffer,
        featureId,
        feature.workspaceId
      );
    } catch (error) {
      console.error('Diagram upload failed:', error);
      return NextResponse.json(
        {
          error: 'Failed to upload diagram to storage',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    // Update feature record with diagram URL and S3 key
    try {
      await db.feature.update({
        where: { id: featureId },
        data: {
          diagramUrl: uploadResult.s3Url,
          diagramS3Key: uploadResult.s3Key,
        },
      });
    } catch (error) {
      console.error('Failed to update feature with diagram info:', error);
      return NextResponse.json(
        {
          error: 'Failed to save diagram information',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      diagramUrl: uploadResult.s3Url,
      s3Key: uploadResult.s3Key,
      success: true,
    });
  } catch (error) {
    console.error('Unexpected error in diagram generation:', error);
    return NextResponse.json(
      {
        error: 'An unexpected error occurred',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
