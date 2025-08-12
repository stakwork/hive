import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";

export interface StoredTest {
  name: string;
  text: string;
  created: string;
  modified: string;
  size: number;
}

const TEST_DIR = path.resolve(process.cwd(), "mock-tests");
const testStore: Map<string, StoredTest> = new Map();

async function ensureDir(): Promise<void> {
  try {
    await fs.mkdir(TEST_DIR, { recursive: true });
  } catch {}
}

function getFilePath(name: string): string {
  const safe = name.replace(/\\/g, "/").replace(/\.\.+/g, ".");
  return path.join(TEST_DIR, safe);
}

async function loadFromDiskIntoCache(): Promise<void> {
  await ensureDir();
  const entries = await fs.readdir(TEST_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = getFilePath(entry.name);
    try {
      const [text, stat] = await Promise.all([
        fs.readFile(full, "utf8"),
        fs.stat(full),
      ]);
      testStore.set(entry.name, {
        name: entry.name,
        text,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        size: stat.size,
      });
    } catch {}
  }
}

export async function listTests(): Promise<StoredTest[]> {
  if (testStore.size === 0) {
    await loadFromDiskIntoCache();
  }
  return Array.from(testStore.values()).sort(
    (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
  );
}

export async function getTest(name: string): Promise<StoredTest | undefined> {
  if (!testStore.has(name)) {
    const full = getFilePath(name);
    try {
      const [text, stat] = await Promise.all([
        fs.readFile(full, "utf8"),
        fs.stat(full),
      ]);
      testStore.set(name, {
        name,
        text,
        created: stat.birthtime.toISOString(),
        modified: stat.mtime.toISOString(),
        size: stat.size,
      });
    } catch {
      return undefined;
    }
  }
  return testStore.get(name);
}

export async function saveTest(
  name: string,
  text: string,
): Promise<StoredTest> {
  await ensureDir();
  const full = getFilePath(name);
  await fs.writeFile(full, text, "utf8");
  const stat = await fs.stat(full);
  const existing = testStore.get(name);
  const record: StoredTest = {
    name,
    text,
    created: existing?.created ?? stat.birthtime.toISOString(),
    modified: stat.mtime.toISOString(),
    size: stat.size,
  };
  testStore.set(name, record);
  return record;
}

export async function deleteTest(name: string): Promise<boolean> {
  const full = getFilePath(name);
  try {
    await fs.unlink(full);
  } catch {}
  return testStore.delete(name);
}

export async function renameTest(
  from: string,
  to: string,
): Promise<StoredTest | null> {
  await ensureDir();
  const src = getFilePath(from);
  const dest = getFilePath(to);
  try {
    await fs.rename(src, dest);
    const [text, stat] = await Promise.all([
      fs.readFile(dest, "utf8"),
      fs.stat(dest),
    ]);
    const record: StoredTest = {
      name: to,
      text,
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
      size: stat.size,
    };
    testStore.delete(from);
    testStore.set(to, record);
    return record;
  } catch {
    return null;
  }
}

export function runTest(name: string): {
  success: boolean;
  output: string;
  errors: string;
} {
  const t = testStore.get(name);
  if (!t) {
    return { success: false, output: "", errors: `Test not found: ${name}` };
  }

  const containsFail = /fail|error|expect\(false\)/i.test(t.text);
  if (containsFail) {
    return {
      success: false,
      output: `Running ${name}...\n1 failing`,
      errors: `Mock failure in ${name}: Assertion failed`,
    };
  }
  return {
    success: true,
    output: `Running ${name}...\nAll tests passed (mock)`,
    errors: "",
  };
}

export function getQueryParam(req: NextRequest, key: string): string | null {
  const { searchParams } = new URL(req.url);
  const value = searchParams.get(key);
  return value && value.trim().length > 0 ? value : null;
}
