import { db } from "@/lib/db";
import { validateFeatureAccess, validateUserStoryAccess, calculateNextOrder } from "./utils";
import { USER_SELECT } from "@/lib/db/selects";

/**
 * Creates a new user story for a feature
 */
export async function createUserStory(featureId: string, userId: string, data: { title: string }) {
  await validateFeatureAccess(featureId, userId);

  if (!data.title || typeof data.title !== "string" || !data.title.trim()) {
    throw new Error("Missing required field: title");
  }

  const user = await db.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const nextOrder = await calculateNextOrder(db.userStory, { featureId });

  const userStory = await db.userStory.create({
    data: {
      title: data.title.trim(),
      featureId,
      order: nextOrder,
      completed: false,
      createdById: userId,
      updatedById: userId,
    },
    include: {
      createdBy: {
        select: USER_SELECT,
      },
      updatedBy: {
        select: USER_SELECT,
      },
      feature: {
        select: {
          id: true,
          title: true,
          workspaceId: true,
        },
      },
    },
  });

  return userStory;
}

/**
 * Updates a user story
 */
export async function updateUserStory(
  storyId: string,
  userId: string,
  data: {
    title?: string;
    order?: number;
    completed?: boolean;
  },
) {
  await validateUserStoryAccess(storyId, userId);

  const updateData: any = {
    updatedById: userId,
  };

  if (data.title !== undefined) {
    if (typeof data.title !== "string" || !data.title.trim()) {
      throw new Error("Invalid title: must be a non-empty string");
    }
    updateData.title = data.title.trim();
  }

  if (data.order !== undefined) {
    if (typeof data.order !== "number" || data.order < 0) {
      throw new Error("Invalid order: must be a non-negative number");
    }
    updateData.order = data.order;
  }

  if (data.completed !== undefined) {
    if (typeof data.completed !== "boolean") {
      throw new Error("Invalid completed: must be a boolean");
    }
    updateData.completed = data.completed;
  }

  const updatedStory = await db.userStory.update({
    where: { id: storyId },
    data: updateData,
    include: {
      createdBy: {
        select: USER_SELECT,
      },
      updatedBy: {
        select: USER_SELECT,
      },
      feature: {
        select: {
          id: true,
          title: true,
          workspaceId: true,
        },
      },
    },
  });

  return updatedStory;
}

/**
 * Deletes a user story
 */
export async function deleteUserStory(storyId: string, userId: string): Promise<void> {
  await validateUserStoryAccess(storyId, userId);

  await db.userStory.delete({
    where: { id: storyId },
  });
}

/**
 * Reorders user stories within a feature
 */
export async function reorderUserStories(
  featureId: string,
  userId: string,
  stories: { id: string; order: number }[],
): Promise<any[]> {
  await validateFeatureAccess(featureId, userId);

  if (!Array.isArray(stories)) {
    throw new Error("Stories must be an array");
  }

  await db.$transaction(
    stories.map((story) =>
      db.userStory.update({
        where: {
          id: story.id,
          featureId: featureId,
        },
        data: { order: story.order },
      }),
    ),
  );

  const updatedStories = await db.userStory.findMany({
    where: { featureId },
    select: {
      id: true,
      title: true,
      order: true,
      completed: true,
      createdAt: true,
      updatedAt: true,
      createdBy: {
        select: USER_SELECT,
      },
      updatedBy: {
        select: USER_SELECT,
      },
    },
    orderBy: { order: "asc" },
  });

  return updatedStories;
}
