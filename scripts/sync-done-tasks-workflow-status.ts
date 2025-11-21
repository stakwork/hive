import { PrismaClient, TaskStatus, WorkflowStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function syncDoneTasksWorkflowStatus() {
  try {
    console.log("Starting sync of DONE tasks to COMPLETED workflow status...");

    // Find all tasks with status=DONE but workflowStatus is not COMPLETED
    const tasksToUpdate = await prisma.task.findMany({
      where: {
        status: TaskStatus.DONE,
        workflowStatus: {
          not: WorkflowStatus.COMPLETED,
        },
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        status: true,
        workflowStatus: true,
      },
    });

    console.log(`Found ${tasksToUpdate.length} tasks to update`);

    if (tasksToUpdate.length === 0) {
      console.log("No tasks need updating. Exiting.");
      return;
    }

    // Update all tasks
    const result = await prisma.task.updateMany({
      where: {
        status: TaskStatus.DONE,
        workflowStatus: {
          not: WorkflowStatus.COMPLETED,
        },
        deleted: false,
      },
      data: {
        workflowStatus: WorkflowStatus.COMPLETED,
      },
    });

    console.log(`✅ Successfully updated ${result.count} tasks`);
    console.log("\nUpdated tasks:");
    tasksToUpdate.forEach((task) => {
      console.log(`  - ${task.title} (${task.id}): ${task.workflowStatus} → COMPLETED`);
    });
  } catch (error) {
    console.error("Error syncing tasks:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

syncDoneTasksWorkflowStatus();
