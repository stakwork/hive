#!/usr/bin/env node
import { createMCPClient } from '@ai-sdk/mcp';

const MCP_URL = process.env.MCP_URL;

if (!MCP_URL) {
  process.stderr.write('MCP_URL is required\n');
  process.exit(1);
}

const [,, toolName, ...rest] = process.argv;

function formatParams(inputSchema) {
  if (!inputSchema?.properties) return '';
  const props = inputSchema.properties;
  const required = inputSchema.required || [];
  const parts = Object.entries(props).map(([key, val]) => {
    const type = val.type || 'any';
    const optional = !required.includes(key);
    return `${key}${optional ? '?' : ''}: ${type}`;
  });
  return parts.length ? `{ ${parts.join(', ')} }` : '';
}

function parseArgs(args) {
  if (!args.length) return {};
  if (args[0].startsWith('{')) {
    return JSON.parse(args.join(' '));
  }
  const result = {};
  for (const arg of args) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx === -1) {
      result[arg] = true;
      continue;
    }
    const key = arg.slice(0, eqIdx);
    const raw = arg.slice(eqIdx + 1);
    try {
      result[key] = JSON.parse(raw);
    } catch {
      result[key] = raw;
    }
  }
  return result;
}

async function main() {
  const client = await createMCPClient({ transport: { type: 'http', url: MCP_URL } });

  try {
    if (!toolName || toolName === '--help' || toolName === '-h') {
      const { tools } = await client.listTools();
      process.stdout.write('Usage: node stadeum.mjs <tool> [key=value ...]\n\n');
      process.stdout.write('Arguments are passed as key=value pairs, e.g.:\n');
      process.stdout.write('  node stadeum.mjs read_feature featureId=abc123\n');
      process.stdout.write('  node stadeum.mjs send_message taskId=abc123 message="hello world"\n\n');
      process.stdout.write('Available tools:\n\n');
      for (const t of tools) {
        const params = formatParams(t.inputSchema);
        process.stdout.write(`  stadeum ${t.name}${params ? ' ' + params : ''}\n`);
        if (t.description) {
          process.stdout.write(`    ${t.description}\n`);
        }
        process.stdout.write('\n');
      }
    } else {
      const tools = await client.tools();
      if (!(toolName in tools)) {
        process.stderr.write(`Unknown tool: ${toolName}\n`);
        await client.close();
        process.exit(1);
      }
      const tool = tools[toolName];
      const args = parseArgs(rest);
      const result = await tool.execute(args, { toolCallId: 'cli', messages: [] });
      for (const part of result.content) {
        if (part.type === 'text') {
          process.stdout.write(part.text + '\n');
        } else {
          process.stdout.write(JSON.stringify(part) + '\n');
        }
      }
    }
  } finally {
    await client.close();
  }
}

main().catch(e => {
  process.stderr.write((e.message || String(e)) + '\n');
  process.exit(1);
});
