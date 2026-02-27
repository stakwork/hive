import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function createTestVideoAttachment() {
  try {
    // Find the first task
    const task = await prisma.task.findFirst({
      where: {
        workspace: {
          slug: 'mock-stakgraph'
        }
      }
    });

    if (!task) {
      console.log("No task found");
      return;
    }

    console.log(`Found task: ${task.id} - ${task.title}`);

    // Create a chat message with video attachment
    const message = await prisma.chatMessage.create({
      data: {
        taskId: task.id,
        role: "ASSISTANT",
        message: "Here's the screen recording of the feature demo",
        attachments: {
          create: [
            {
              filename: "feature-demo.webm",
              mimeType: "video/webm",
              size: 1024000,
              path: "test/feature-demo.webm"
            },
            {
              filename: "screenshot.png",
              mimeType: "image/png",
              size: 512000,
              path: "test/screenshot.png"
            }
          ]
        }
      },
      include: {
        attachments: true
      }
    });

    console.log("Created message with attachments:");
    console.log(JSON.stringify(message, null, 2));
    console.log(`\nView at: http://localhost:3000/w/mock-stakgraph/task/${task.id}`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestVideoAttachment();
