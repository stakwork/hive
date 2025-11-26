import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth';
import { findSimilarFeatures } from '@/services/roadmap/features';
import { validateWorkspaceAccessById } from '@/services/workspace';
import { getErrorMessage } from '@/lib/utils/error';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { workspaceId, title, brief } = body;

    // Validate required parameters
    if (!workspaceId || typeof workspaceId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'workspaceId is required' },
        { status: 400 }
      );
    }

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'title is required' },
        { status: 400 }
      );
    }

    // Validate workspace access
    const accessValidation = await validateWorkspaceAccessById(
      workspaceId,
      session.user.id
    );

    if (!accessValidation.hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: No access to this workspace' },
        { status: 403 }
      );
    }

    // Find similar features
    const duplicates = await findSimilarFeatures({
      workspaceId,
      title,
      brief,
    });

    return NextResponse.json(
      {
        success: true,
        data: { duplicates },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error checking duplicates:', error);
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}
