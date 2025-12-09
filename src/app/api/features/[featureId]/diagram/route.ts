import { NextRequest, NextResponse } from 'next/server';
import { getMiddlewareContext, requireAuth } from '@/lib/middleware/utils';
import { db } from '@/lib/db';
import { getDiagramStorageService } from '@/services/diagram-storage';

export async function DELETE(
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

    // Check if diagram exists
    if (!feature.diagramS3Key) {
      return NextResponse.json(
        { error: 'No diagram found for this feature' },
        { status: 404 }
      );
    }

    // Delete diagram from S3
    try {
      const diagramStorage = getDiagramStorageService();
      await diagramStorage.deleteDiagram(feature.diagramS3Key);
    } catch (error) {
      console.error('Failed to delete diagram from S3:', error);
      return NextResponse.json(
        {
          error: 'Failed to delete diagram from storage',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    // Clear diagram fields from feature record
    try {
      await db.feature.update({
        where: { id: featureId },
        data: {
          diagramUrl: null,
          diagramS3Key: null,
        },
      });
    } catch (error) {
      console.error('Failed to clear diagram fields from feature:', error);
      return NextResponse.json(
        {
          error: 'Failed to update feature record',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Diagram deleted successfully',
    });
  } catch (error) {
    console.error('Unexpected error in diagram deletion:', error);
    return NextResponse.json(
      {
        error: 'An unexpected error occurred',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
