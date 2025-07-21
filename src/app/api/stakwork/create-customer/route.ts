import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/nextauth';
import { stakworkService } from '@/lib/service-factory';
import { type ApiError } from '@/types';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId } = body;

    const customer = await stakworkService().createCustomer(workspaceId)

    if (customer.success && customer.data) {

      const { token } = customer?.data || {};


      const workspace = await db.workspace.findFirst({ where: { id: workspaceId } });

      if (workspace) {
        await db.workspace.update({
          where: { id: workspace.id },
          data: {
            stakworkApiKey: token, // ✅ camelCase field name from Prisma schema
          },
        });
      }

      const swarm = await db.swarm.findFirst({
        where: {
          workspaceId: workspace.id,
        }
      })

      const sanitizedSecretAlias = swarm.swarmSecretAlias.replace(/{{(.*?)}}/g, "$1");

      await stakworkService().createSecret(sanitizedSecretAlias, swarm.swarmApiKey, token)


      return NextResponse.json({ customer }, { status: 201 });
    }
  } catch (error) {
    console.error('Error creating Stakwork customer:', error);

    // Handle ApiError specifically
    if (error && typeof error === 'object' && 'status' in error) {
      const apiError = error as ApiError;
      return NextResponse.json(
        {
          error: apiError.message,
          service: apiError.service,
          details: apiError.details
        },
        { status: apiError.status }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    );
  }
}
