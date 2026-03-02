import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Update any mock user to be a superadmin
  const updated = await prisma.user.updateMany({
    where: {
      email: {
        endsWith: "@mock.dev"
      }
    },
    data: {
      role: "SUPER_ADMIN"
    }
  });
  
  console.log(`Updated ${updated.count} users to SUPER_ADMIN`);
  
  // Also create one if it doesn't exist
  if (updated.count === 0) {
    const user = await prisma.user.upsert({
      where: { email: "admin@mock.dev" },
      update: { role: "SUPER_ADMIN" },
      create: {
        email: "admin@mock.dev",
        name: "Admin User",
        role: "SUPER_ADMIN",
        emailVerified: new Date()
      }
    });
    console.log(`Created superadmin user: ${user.email} (${user.id})`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
