import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Realistic developer questions for mock conversations
const userQuestions = [
  "How do I implement authentication in a Next.js app?",
  "What's the best way to handle form validation in React?",
  "Can you explain the difference between useEffect and useLayoutEffect?",
  "How can I optimize the performance of my React components?",
  "What are the best practices for state management in large applications?",
  "How do I set up a CI/CD pipeline for a Node.js application?",
  "Can you help me debug this TypeScript error I'm getting?",
  "What's the recommended approach for handling errors in async operations?",
  "How do I implement server-side rendering with Next.js?",
  "Can you explain how to use React Query for data fetching?",
  "What are the security best practices for handling API keys?",
  "How do I set up end-to-end testing with Playwright?",
  "Can you help me optimize my database queries for better performance?",
  "What's the best way to implement real-time features in a web application?",
  "How do I handle file uploads in a Next.js API route?",
  "Can you explain the concept of code splitting and lazy loading?",
  "What are the benefits of using TypeScript over JavaScript?",
  "How do I implement role-based access control in my application?",
  "Can you help me understand webhooks and how to implement them?",
  "What's the difference between SSR, SSG, and ISR in Next.js?",
];

const assistantResponses = [
  "Great question! Let me walk you through the implementation step by step...",
  "There are several approaches you can take. Here's what I recommend...",
  "That's a common issue developers face. Here's how you can solve it...",
  "Let me break this down for you with some examples...",
  "I'd be happy to help! Here's the best approach based on current best practices...",
  "This is an important concept. Let me explain it clearly...",
  "I can see what you're trying to achieve. Here's how to do it properly...",
  "Let's tackle this together. First, we need to understand...",
  "Good thinking! Here's how you can implement this feature...",
  "That's a great use case. Here's what you should consider...",
];

const followUpQuestionSets = [
  [
    "How do I handle authentication tokens securely?",
    "What's the difference between session-based and token-based auth?",
    "Should I use JWT or sessions for my use case?",
  ],
  [
    "How do I optimize re-renders in React?",
    "What's the difference between useMemo and useCallback?",
    "When should I use React.memo?",
  ],
  [
    "How do I implement error boundaries?",
    "What's the best way to handle async errors?",
    "Should I use try-catch or error boundaries?",
  ],
  [
    "How do I set up Prisma with PostgreSQL?",
    "What are the best practices for database migrations?",
    "How do I handle database transactions?",
  ],
  [
    "How do I implement WebSocket connections?",
    "What's the difference between WebSockets and Server-Sent Events?",
    "Should I use a library like Pusher or implement my own?",
  ],
];

const provenanceDataSamples = [
  {
    sources: [
      {
        title: "Next.js Authentication Documentation",
        url: "https://nextjs.org/docs/authentication",
        snippet: "Learn how to add authentication to your Next.js application...",
      },
      {
        title: "NextAuth.js Guide",
        url: "https://next-auth.js.org/getting-started",
        snippet: "NextAuth.js is a complete open-source authentication solution...",
      },
    ],
  },
  {
    sources: [
      {
        title: "React Hook Form Documentation",
        url: "https://react-hook-form.com/get-started",
        snippet: "Performant, flexible and extensible forms with easy-to-use validation...",
      },
    ],
  },
  {
    sources: [
      {
        title: "Prisma Best Practices",
        url: "https://www.prisma.io/docs/guides/performance-and-optimization",
        snippet: "Learn how to optimize your Prisma queries for better performance...",
      },
      {
        title: "Database Indexing Guide",
        url: "https://www.postgresql.org/docs/current/indexes.html",
        snippet: "Indexes are a common way to enhance database performance...",
      },
    ],
  },
];

// Sample base64 image (1x1 transparent pixel)
const sampleImageData =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateTitle(firstMessage: string): string {
  // Extract first 50 chars or until first newline/period
  const truncated = firstMessage.split(/[\n.]/)[0].slice(0, 50);
  return truncated.length < firstMessage.length ? `${truncated}...` : truncated;
}

function generateConversationTimestamp(baseDate: Date, index: number): Date {
  // More recent conversations should be more frequent
  // Spread conversations over last 3 weeks with exponential distribution
  const weeksAgo = Math.random() * Math.random() * 3; // Biased toward recent
  const daysAgo = weeksAgo * 7;
  const hoursAgo = daysAgo * 24 + Math.random() * 24;
  const date = new Date(baseDate.getTime() - hoursAgo * 60 * 60 * 1000);
  return date;
}

export async function seedDashboardConversations(users: any[]) {
  console.log("🗨️  Seeding dashboard conversations...");

  if (users.length === 0) {
    console.log("No users found. Skipping conversation seeding.");
    return;
  }

  // Get all workspaces
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, slug: true, ownerId: true },
  });

  if (workspaces.length === 0) {
    console.log("No workspaces found. Skipping conversation seeding.");
    return;
  }

  const baseDate = new Date();
  let totalConversations = 0;

  for (const workspace of workspaces) {
    console.log(`  Creating conversations for workspace: ${workspace.slug}`);

    // Use workspace owner as the user for conversations
    const userId = workspace.ownerId;

    // Create 15 conversations per workspace
    for (let i = 0; i < 15; i++) {
      const messageCount = getRandomInt(2, 10);
      const hasImages = i < 2; // First 2 conversations have images
      const hasProvenance = Math.random() > 0.5;
      const hasFollowUps = Math.random() > 0.6;
      const source = Math.random() > 0.3 ? "dashboard" : null;

      const messages: any[] = [];
      const conversationTimestamp = generateConversationTimestamp(baseDate, i);

      // Generate conversation messages
      for (let j = 0; j < messageCount; j++) {
        const isUserMessage = j % 2 === 0;
        const messageTimestamp = new Date(
          conversationTimestamp.getTime() + j * 2 * 60 * 1000 // 2 minutes apart
        );

        if (isUserMessage) {
          const question =
            j === 0
              ? userQuestions[i % userQuestions.length]
              : `Follow-up: ${userQuestions[(i + j) % userQuestions.length]}`;

          messages.push({
            id: `msg-${i}-${j}`,
            role: "user",
            content: question,
            timestamp: messageTimestamp,
            imageData: hasImages && j === 0 ? sampleImageData : undefined,
          });
        } else {
          const response = assistantResponses[j % assistantResponses.length];
          const toolCalls =
            Math.random() > 0.7
              ? [
                  {
                    id: `tool-${i}-${j}`,
                    name: "searchCodebase",
                    input: { query: "authentication" },
                    result: "Found 5 relevant files...",
                  },
                ]
              : undefined;

          messages.push({
            id: `msg-${i}-${j}`,
            role: "assistant",
            content: response,
            timestamp: messageTimestamp,
            toolCalls,
          });
        }
      }

      const firstUserMessage = messages.find((m) => m.role === "user")?.content || "";
      const title = generateTitle(firstUserMessage);

      // Add some very long titles for testing truncation
      const finalTitle =
        i === 13
          ? "This is an intentionally very long conversation title that should be truncated in the UI to test how the component handles overflow text"
          : title;

      const lastMessage = messages[messages.length - 1];

      await prisma.sharedConversation.create({
        data: {
          workspaceId: workspace.id,
          userId: userId,
          title: finalTitle,
          messages,
          source,
          lastMessageAt: lastMessage.timestamp,
          followUpQuestions: hasFollowUps
            ? getRandomElement(followUpQuestionSets)
            : [],
          provenanceData: (hasProvenance
            ? getRandomElement(provenanceDataSamples)
            : null) as any,
          isShared: false,
        },
      });

      totalConversations++;
    }
  }

  console.log(`✅ Created ${totalConversations} dashboard conversations`);
}
