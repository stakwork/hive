const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const screenshots = await prisma.screenshot.findMany({
    include: {
      task: {
        select: {
          id: true,
          title: true,
          feature: {
            select: {
              id: true,
              title: true
            }
          }
        }
      }
    }
  });
  
  console.log(`Total screenshots: ${screenshots.length}`);
  
  if (screenshots.length > 0) {
    console.log('\nScreenshots by feature:');
    const byFeature = {};
    screenshots.forEach(s => {
      const featureTitle = s.task.feature?.title || 'No feature';
      if (!byFeature[featureTitle]) byFeature[featureTitle] = [];
      byFeature[featureTitle].push({
        taskTitle: s.task.title,
        actionIndex: s.actionIndex,
        pageUrl: s.pageUrl
      });
    });
    console.log(JSON.stringify(byFeature, null, 2));
  }
}

main().finally(() => prisma.$disconnect());
