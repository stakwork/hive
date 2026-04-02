import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { optionalEnvVars } from '@/config/env';
import { validateWorkspaceSlug } from '@/services/workspace';
import { getErrorMessage } from '@/lib/utils/error';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');

    if (!slug) {
      return NextResponse.json(
        { success: false, error: 'Slug parameter is required' },
        { status: 400 }
      );
    }

    const normalizedSlug = slug.toLowerCase();

    // Check format and reserved words
    const validation = validateWorkspaceSlug(normalizedSlug);
    if (!validation.isValid) {
      return NextResponse.json({
        success: true,
        data: {
          slug,
          isAvailable: false,
          message: validation.error,
        },
      });
    }

    // Check Hive DB
    const existingWorkspace = await db.workspace.findUnique({
      where: { slug: normalizedSlug },
      select: { id: true },
    });

    if (existingWorkspace) {
      return NextResponse.json({
        success: true,
        data: {
          slug,
          isAvailable: false,
          message: 'A workspace with this slug already exists',
        },
      });
    }

    // Check swarm super admin vanity address registry
    const swarmAdminUrl = optionalEnvVars.SWARM_SUPER_ADMIN_URL;
    if (swarmAdminUrl) {
      try {
        const res = await fetch(
          `${swarmAdminUrl}/api/super/check-domain?domain=${encodeURIComponent(`${normalizedSlug}.sphinx.chat`)}`,
          {
            headers: {
              'x-super-token': process.env.SWARM_SUPERADMIN_API_KEY as string,
            },
          }
        );

        if (res.ok) {
          const data = await res.json();
          if (data?.data?.domain_exists === true) {
            return NextResponse.json({
              success: true,
              data: {
                slug,
                isAvailable: false,
                message: 'This name is already in use as a graph workspace. Please choose a different name.',
              },
            });
          }
        } else {
          logger.warn('Swarm admin domain check returned non-OK status', 'graphmindset-slug-availability', {
            status: res.status,
          });
        }
      } catch (err) {
        logger.warn('Swarm admin unreachable during slug check, falling back to DB result', 'graphmindset-slug-availability', {
          err: getErrorMessage(err, 'unknown error'),
        });
      }
    } else {
      logger.warn('SWARM_SUPER_ADMIN_URL not configured, skipping vanity address check', 'graphmindset-slug-availability');
    }

    return NextResponse.json({
      success: true,
      data: {
        slug,
        isAvailable: true,
        message: 'Slug is available',
      },
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Failed to check slug availability');
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
