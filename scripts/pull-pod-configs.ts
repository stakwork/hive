import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

// File names we want to extract from each swarm's containerFiles JSON.
const TARGET_FILES = ["pm2.config.js", "docker-compose.yml"];

// Fenced-code-block language per file name.
const FILE_LANG: Record<string, string> = {
  "pm2.config.js": "ts",
  "docker-compose.yml": "yml",
};

function decodeBase64(content: string): string {
  return Buffer.from(content, "base64").toString("utf-8");
}

function fencedBlock(fileName: string, content: string): string {
  const lang = FILE_LANG[fileName] ?? "";
  return `FILENAME: ${fileName}\n\n\`\`\`${lang}\n${content}\n\`\`\``;
}

// Derive an "org/repo" header from a GitHub repository URL.
function repoHeader(repositoryUrl: string | undefined, fallback: string): string {
  if (!repositoryUrl) return fallback;
  const match = repositoryUrl.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return match ? match[1] : fallback;
}

async function main() {
  const slugs = process.argv.slice(2);

  if (slugs.length === 0) {
    console.error(
      "Usage: tsx scripts/pull-pod-configs.ts <slug> [<slug> ...]"
    );
    process.exit(1);
  }

  const outDir = join(process.cwd(), "scripts", "pod-configs-output");
  mkdirSync(outDir, { recursive: true });

  const masterSections: string[] = [];

  for (const slug of slugs) {
    console.log(`\n=== ${slug} ===`);

    const workspace = await prisma.workspace.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        repositories: {
          select: { repositoryUrl: true },
        },
        swarm: {
          select: { name: true, containerFiles: true },
        },
      },
    });

    if (!workspace) {
      console.warn(`  ⚠ workspace not found`);
      continue;
    }
    if (!workspace.swarm) {
      console.warn(`  ⚠ no swarm for workspace`);
      continue;
    }

    const rawFiles =
      (workspace.swarm.containerFiles as Record<string, string> | null) ?? null;
    if (!rawFiles || typeof rawFiles !== "object") {
      console.warn(`  ⚠ no containerFiles on swarm`);
      continue;
    }

    const slugDir = join(outDir, slug);
    mkdirSync(slugDir, { recursive: true });

    const blocks: string[] = [];
    for (const fileName of TARGET_FILES) {
      const encoded = rawFiles[fileName];
      if (!encoded) {
        console.warn(`  ⚠ ${fileName} not present`);
        continue;
      }

      const content = decodeBase64(encoded);
      const outPath = join(slugDir, fileName);
      writeFileSync(outPath, content, "utf-8");
      console.log(`  ✓ wrote ${outPath}`);

      blocks.push(fencedBlock(fileName, content));
    }

    if (blocks.length > 0) {
      const repos = workspace.repositories
        .map((r) => repoHeader(r.repositoryUrl, ""))
        .filter(Boolean)
        .join("\n");
      const repoList = repos ? `${repos}\n\n` : "";
      masterSections.push(`# ${slug}\n\n${repoList}${blocks.join("\n\n")}`);
    }
  }

  // One master file for ALL processed repos, separated by repo headers.
  if (masterSections.length > 0) {
    const masterPath = join(outDir, "all-pod-configs.md");
    writeFileSync(masterPath, masterSections.join("\n\n") + "\n", "utf-8");
    console.log(`\n✓ wrote master file ${masterPath}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
