import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Update the video attachment to use a data URL for a small test video
  // This bypasses S3 and presigned URL issues
  const videoDataUrl = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGQ2hyb21lFlSua7+uvdeBAXPFh/////////+BAaWIhb+DgQKGhL+DgQNLU0WIhb+DgQKGhb+DgQOghL+DgQNLU0WIhb+DgQKGhL+DgQKBAaWIhb+DgQKGhL+DgQNLU0WIhb+DgQKGhL+DgQKghL+DgQOghL+DgQNLU0WIhb+DgQKGhL+DgQOBAaWIhb+DgQKGhL+DgQNLU0WIhb+DgQKGhL+DgQOghL+DgQOghL+DgQNLU0WIhb+DgQKGhL+DgQOghL+DgQOBAaWI';
  
  await prisma.attachment.update({
    where: {
      id: 'cmm4vwyaf0002ym9kile2n3gg'
    },
    data: {
      path: videoDataUrl
    }
  });
  
  console.log('Updated video attachment with data URL');
}

main().catch(console.error).finally(() => prisma.$disconnect());
