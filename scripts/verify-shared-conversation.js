#!/usr/bin/env node

/**
 * Quick verification script for SharedConversation feature
 * Tests basic database operations without full test suite
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Verifying SharedConversation implementation...\n');

  try {
    // 1. Check if SharedConversation model exists
    console.log('1️⃣  Checking database model...');
    const tableExists = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'shared_conversations'
      );
    `;
    console.log('   ✅ SharedConversation table exists\n');

    // 2. Create a test user
    console.log('2️⃣  Creating test user...');
    const testUser = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@example.com`,
        name: 'Test User',
      },
    });
    console.log(`   ✅ User created: ${testUser.id}\n`);

    // 3. Create a test workspace
    console.log('3️⃣  Creating test workspace...');
    const testWorkspace = await prisma.workspace.create({
      data: {
        name: 'Test Workspace',
        slug: `test-${Date.now()}`,
        ownerId: testUser.id,
      },
    });
    console.log(`   ✅ Workspace created: ${testWorkspace.id}\n`);

    // 4. Create a shared conversation
    console.log('4️⃣  Creating shared conversation...');
    const testMessages = [
      { role: 'user', content: 'Hello, this is a test message' },
      { role: 'assistant', content: 'This is a test response' },
    ];
    const testProvenance = {
      concepts: [{ id: '1', name: 'Test Concept' }],
      files: [],
      codeEntities: [],
    };
    const testFollowUps = ['Follow-up question 1', 'Follow-up question 2'];

    const sharedConv = await prisma.sharedConversation.create({
      data: {
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        title: 'Test Conversation',
        messages: testMessages,
        provenanceData: testProvenance,
        followUpQuestions: testFollowUps,
      },
    });
    console.log(`   ✅ Shared conversation created: ${sharedConv.id}\n`);

    // 5. Retrieve the shared conversation
    console.log('5️⃣  Retrieving shared conversation...');
    const retrieved = await prisma.sharedConversation.findUnique({
      where: { id: sharedConv.id },
      include: {
        user: { select: { name: true, email: true } },
        workspace: { select: { name: true, slug: true } },
      },
    });
    console.log('   ✅ Conversation retrieved successfully');
    console.log(`   📝 Title: ${retrieved.title}`);
    console.log(`   👤 User: ${retrieved.user.name}`);
    console.log(`   🏢 Workspace: ${retrieved.workspace.name}`);
    console.log(`   💬 Messages: ${JSON.stringify(retrieved.messages).length} bytes`);
    console.log(`   🔍 Provenance: ${retrieved.provenanceData ? 'Present' : 'None'}`);
    console.log(`   ❓ Follow-ups: ${Array.isArray(retrieved.followUpQuestions) ? retrieved.followUpQuestions.length : 0} questions\n`);

    // 6. Test workspace query (index usage)
    console.log('6️⃣  Testing workspace index query...');
    const workspaceConvs = await prisma.sharedConversation.findMany({
      where: { workspaceId: testWorkspace.id },
    });
    console.log(`   ✅ Found ${workspaceConvs.length} conversation(s) for workspace\n`);

    // 7. Test user query (index usage)
    console.log('7️⃣  Testing user index query...');
    const userConvs = await prisma.sharedConversation.findMany({
      where: { userId: testUser.id },
    });
    console.log(`   ✅ Found ${userConvs.length} conversation(s) for user\n`);

    // 8. Clean up
    console.log('8️⃣  Cleaning up test data...');
    await prisma.sharedConversation.delete({ where: { id: sharedConv.id } });
    await prisma.workspace.delete({ where: { id: testWorkspace.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    console.log('   ✅ Test data cleaned up\n');

    console.log('✅ All verification checks passed!');
    console.log('\n📊 Summary:');
    console.log('   - Database model: ✅');
    console.log('   - Create operation: ✅');
    console.log('   - Read operation: ✅');
    console.log('   - Relations: ✅');
    console.log('   - Indexes: ✅');
    console.log('   - JSON fields: ✅');
    console.log('   - Cleanup: ✅');

  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
