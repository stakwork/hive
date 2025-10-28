/**
 * Test script to verify that task mode is being saved correctly
 * Run with: node test-mode-fix.js
 */

const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

async function testModeFix() {
  console.log('=== TESTING MODE FIELD FIX ===\n');
  
  try {
    // 1. Check all tasks and their modes
    const allTasks = await db.task.findMany({
      where: { deleted: false },
      select: {
        id: true,
        title: true,
        mode: true,
        workflowStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    
    console.log(`Total tasks in database: ${allTasks.length}\n`);
    
    if (allTasks.length > 0) {
      console.log('Recent tasks and their modes:');
      allTasks.forEach(task => {
        console.log(`- ${task.id}: mode="${task.mode}", status=${task.workflowStatus}`);
      });
      console.log('');
    }
    
    // 2. Count tasks by mode
    const modes = await db.task.groupBy({
      by: ['mode'],
      where: { deleted: false },
      _count: true,
    });
    
    console.log('Tasks grouped by mode:');
    modes.forEach(m => {
      console.log(`  ${m.mode || 'null'}: ${m._count} tasks`);
    });
    console.log('');
    
    // 3. Check for agent mode tasks specifically
    const agentTasks = await db.task.findMany({
      where: {
        mode: 'agent',
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        workflowStatus: true,
        createdAt: true,
      },
    });
    
    console.log(`Tasks with mode="agent": ${agentTasks.length}`);
    if (agentTasks.length > 0) {
      agentTasks.forEach(task => {
        console.log(`  - ${task.id}: ${task.title} (${task.workflowStatus})`);
      });
    }
    console.log('');
    
    // 4. Check what stale agent tasks would be found now
    const now = new Date();
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
    
    const staleAgentTasks = await db.task.findMany({
      where: {
        mode: 'agent',
        status: 'IN_PROGRESS',
        createdAt: {
          lt: twentyFourHoursAgo,
        },
        deleted: false,
      },
    });
    
    console.log(`Stale agent tasks (>24h old, IN_PROGRESS): ${staleAgentTasks.length}`);
    if (staleAgentTasks.length > 0) {
      staleAgentTasks.forEach(task => {
        const age = (now - task.createdAt) / (1000 * 60 * 60);
        console.log(`  - ${task.id}: ${task.title} (age: ${age.toFixed(1)}h)`);
      });
    }
    
    console.log('\n=== TEST COMPLETE ===');
    console.log('');
    console.log('To verify the fix works:');
    console.log('1. Create a new task with mode="agent"');
    console.log('2. Run this script again to see it in the database');
    console.log('3. After 24+ hours, the haltStaleAgentTasks function should find it');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.$disconnect();
  }
}

testModeFix();
