import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WORKSPACE_ID = "cmi6hquli0006ml4ong0m5max";

const FAKE_MEMBERS = [
  {
    name: "Alice Johnson",
    email: "alice.johnson@example.com",
    image: "https://i.pravatar.cc/150?img=1",
    role: "ADMIN" as const,
  },
  {
    name: "Bob Smith",
    email: "bob.smith@example.com",
    image: "https://i.pravatar.cc/150?img=12",
    role: "DEVELOPER" as const,
  },
  {
    name: "Carol Williams",
    email: "carol.williams@example.com",
    image: "https://i.pravatar.cc/150?img=5",
    role: "DEVELOPER" as const,
  },
  {
    name: "David Brown",
    email: "david.brown@example.com",
    image: "https://i.pravatar.cc/150?img=13",
    role: "PM" as const,
  },
  {
    name: "Emma Davis",
    email: "emma.davis@example.com",
    image: "https://i.pravatar.cc/150?img=9",
    role: "DEVELOPER" as const,
  },
  {
    name: "Frank Miller",
    email: "frank.miller@example.com",
    image: "https://i.pravatar.cc/150?img=14",
    role: "STAKEHOLDER" as const,
  },
  {
    name: "Grace Wilson",
    email: "grace.wilson@example.com",
    image: "https://i.pravatar.cc/150?img=10",
    role: "DEVELOPER" as const,
  },
  {
    name: "Henry Moore",
    email: "henry.moore@example.com",
    image: "https://i.pravatar.cc/150?img=15",
    role: "VIEWER" as const,
  },
];

async function addFakeMembers() {
  console.log(`Adding fake members to workspace: ${WORKSPACE_ID}\n`);

  // Check if workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { id: WORKSPACE_ID },
  });

  if (!workspace) {
    console.error(`❌ Workspace ${WORKSPACE_ID} not found`);
    process.exit(1);
  }

  console.log(`✅ Found workspace: ${workspace.name}\n`);

  for (const member of FAKE_MEMBERS) {
    try {
      // Check if user already exists
      let user = await prisma.user.findUnique({
        where: { email: member.email },
      });

      if (!user) {
        // Create new user
        user = await prisma.user.create({
          data: {
            name: member.name,
            email: member.email,
            image: member.image,
            emailVerified: new Date(),
          },
        });
        console.log(`✅ Created user: ${member.name}`);
      } else {
        console.log(`ℹ️  User already exists: ${member.name}`);
      }

      // Check if already a member
      const existingMember = await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: WORKSPACE_ID,
            userId: user.id,
          },
        },
      });

      if (existingMember) {
        console.log(`   ⚠️  Already a member with role: ${existingMember.role}`);
        continue;
      }

      // Add as workspace member
      await prisma.workspaceMember.create({
        data: {
          workspaceId: WORKSPACE_ID,
          userId: user.id,
          role: member.role,
          joinedAt: new Date(),
        },
      });

      console.log(`   ➕ Added as ${member.role}\n`);
    } catch (error) {
      console.error(`❌ Error adding ${member.name}:`, error);
    }
  }

  // Show final count
  const totalMembers = await prisma.workspaceMember.count({
    where: { workspaceId: WORKSPACE_ID },
  });

  console.log(`\n🎉 Done! Total members in workspace: ${totalMembers}`);
}

addFakeMembers()
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
