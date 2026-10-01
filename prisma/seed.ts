import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.activity.createMany({
    data: [
      { 
        userId: 'user-1', 
        type: 'MILESTONE', 
        description: 'Completed Project Alpha', 
        createdAt: new Date() 
      },
      { 
        userId: 'user-1', 
        type: 'TASK', 
        description: 'Updated documentation', 
        createdAt: new Date() 
      },
      { 
        userId: 'user-1', 
        type: 'MILESTONE', 
        description: 'Reached 100 contributors', 
        createdAt: new Date() 
      },
    ],
  });
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());
