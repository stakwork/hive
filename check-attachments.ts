import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const messages = await prisma.chatMessage.findMany({
    where: {
      message: {
        contains: 'screen recording of the feature demo'
      }
    },
    include: {
      attachments: true
    }
  });
  
  console.log(JSON.stringify(messages, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
