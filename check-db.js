const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDatabase() {
  try {
    console.log('Checking database...\n');
    
    // Check workspaces
    const workspaces = await prisma.workspace.findMany({
      take: 5,
      select: { id: true, name: true, slug: true }
    });
    console.log('Workspaces:', workspaces);
    
    // Check swarms
    const swarms = await prisma.swarm.findMany({
      take: 5,
      select: { id: true, name: true, workspaceId: true }
    });
    console.log('\nSwarms:', swarms);
    
    // Check repositories
    const repos = await prisma.repository.findMany({
      take: 5,
      select: { id: true, repositoryUrl: true, workspaceId: true }
    });
    console.log('\nRepositories:', repos);
    
    // Check source control tokens
    const tokens = await prisma.sourceControlToken.findMany({
      take: 5,
      select: { id: true, provider: true, workspaceId: true }
    });
    console.log('\nSource Control Tokens:', tokens);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();
