const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find the "Login Flow Test" task
  const loginTask = await prisma.task.findFirst({
    where: { title: "Login Flow Test" },
    include: { feature: true }
  });
  
  console.log('Login Flow Test task:', loginTask ? {
    id: loginTask.id,
    title: loginTask.title,
    featureId: loginTask.featureId,
    feature: loginTask.feature?.title
  } : 'Not found');
  
  // Find User Authentication feature
  const userAuthFeature = await prisma.feature.findFirst({
    where: { 
      title: "User Authentication",
      workspace: { slug: "mock-stakgraph" }
    },
    include: {
      tasks: {
        select: { id: true, title: true }
      }
    }
  });
  
  console.log('\nUser Authentication feature:', userAuthFeature ? {
    id: userAuthFeature.id,
    title: userAuthFeature.title,
    taskCount: userAuthFeature.tasks.length
  } : 'Not found');
  
  // Link the screenshots tasks to User Authentication feature if they're orphaned
  if (loginTask && !loginTask.featureId && userAuthFeature) {
    await prisma.task.update({
      where: { id: loginTask.id },
      data: { featureId: userAuthFeature.id }
    });
    console.log('\n✓ Linked Login Flow Test to User Authentication feature');
  }
  
  const signupTask = await prisma.task.findFirst({
    where: { title: "Signup Flow Test" }
  });
  
  if (signupTask && !signupTask.featureId && userAuthFeature) {
    await prisma.task.update({
      where: { id: signupTask.id },
      data: { featureId: userAuthFeature.id }
    });
    console.log('✓ Linked Signup Flow Test to User Authentication feature');
  }
}

main().finally(() => prisma.$disconnect());
