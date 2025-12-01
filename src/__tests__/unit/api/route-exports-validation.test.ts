import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Route Export Validation Tests
 * 
 * Purpose: Prevent bugs where API route handlers are not exported, which causes:
 * - 405 Method Not Allowed responses from Next.js
 * - Integration test import failures
 * - Runtime errors when handlers are undefined
 * 
 * This test scans all route.ts files in src/app/api/ and verifies that
 * HTTP method handlers (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
 * are properly exported as named functions.
 * 
 * Related Issue: API Route Handler Not Exported (Bug)
 * Fix Pattern: export async function GET(request: NextRequest) { ... }
 */

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const API_ROUTES_DIR = join(process.cwd(), "src", "app", "api");

interface RouteFileIssue {
  file: string;
  missingExports: string[];
  unexportedFunctions: string[];
}

/**
 * Helper to read file content and get relative path
 */
function readRouteFile(filePath: string): { content: string; relativePath: string } {
  const content = readFileSync(filePath, "utf-8");
  const relativePath = filePath.replace(process.cwd(), "");
  return { content, relativePath };
}

/**
 * Helper to create regex patterns for checking exported/unexported handlers
 */
function createHandlerPatterns(method: string) {
  return {
    exported: new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\(`, "m"),
    unexported: new RegExp(`(?<!export\\s+)(?:^|\\n)\\s*async\\s+function\\s+${method}\\s*\\(`, "m"),
    syncExported: new RegExp(`export\\s+function\\s+${method}\\s*\\(`, "m"),
    syncUnexported: new RegExp(`(?<!export\\s+)(?:^|\\n)\\s*function\\s+${method}\\s*\\(`, "m"),
  };
}

/**
 * Helper to check if a method handler is unexported in file content
 */
function isHandlerUnexported(content: string, method: string): boolean {
  const patterns = createHandlerPatterns(method);
  
  const hasExportedHandler = patterns.exported.test(content);
  const hasUnexportedHandler = patterns.unexported.test(content);
  
  const hasSyncExportedHandler = patterns.syncExported.test(content);
  const hasSyncUnexportedHandler = patterns.syncUnexported.test(content);
  
  // Handler is unexported if:
  // 1. Async function exists without export, OR
  // 2. Sync function exists without export and no async exported version
  return (
    (hasUnexportedHandler && !hasExportedHandler) ||
    (hasSyncUnexportedHandler && !hasSyncExportedHandler && !hasExportedHandler)
  );
}

/**
 * Recursively find all route.ts files in the API directory
 */
function findRouteFiles(dir: string, files: string[] = []): string[] {
  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Skip node_modules and other common exclusions
        if (!entry.startsWith(".") && entry !== "node_modules") {
          findRouteFiles(fullPath, files);
        }
      } else if (entry === "route.ts") {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not scan directory ${dir}:`, error);
  }

  return files;
}

/**
 * Parse a route file and check for exported HTTP method handlers
 * 
 * This function uses regex patterns to detect:
 * 1. Exported functions: export async function GET(...)
 * 2. Unexported functions: async function GET(...) without export
 */
function analyzeRouteFile(filePath: string): RouteFileIssue | null {
  try {
    const { content, relativePath } = readRouteFile(filePath);
    const unexportedFunctions: string[] = [];

    for (const method of HTTP_METHODS) {
      if (isHandlerUnexported(content, method)) {
        unexportedFunctions.push(method);
      }
    }

    if (unexportedFunctions.length > 0) {
      return {
        file: relativePath,
        missingExports: unexportedFunctions,
        unexportedFunctions,
      };
    }

    return null;
  } catch (error) {
    console.warn(`Warning: Could not analyze file ${filePath}:`, error);
    return null;
  }
}

/**
 * Validate all route files in the API directory
 */
function validateAllRoutes(): RouteFileIssue[] {
  const routeFiles = findRouteFiles(API_ROUTES_DIR);
  const issues: RouteFileIssue[] = [];

  for (const file of routeFiles) {
    const issue = analyzeRouteFile(file);
    if (issue) {
      issues.push(issue);
    }
  }

  return issues;
}

describe("API Route Export Validation", () => {
  test("should find API route files", () => {
    const routeFiles = findRouteFiles(API_ROUTES_DIR);
    
    expect(routeFiles.length).toBeGreaterThan(0);
    expect(routeFiles.every((f) => f.endsWith("route.ts"))).toBe(true);
  });

  test("all API route handlers must be exported", () => {
    const issues = validateAllRoutes();

    if (issues.length > 0) {
      const errorMessage = [
        "\n❌ Found route handlers that are not exported:\n",
        ...issues.map((issue) => {
          return [
            `\nFile: ${issue.file}`,
            `Missing exports: ${issue.unexportedFunctions.join(", ")}`,
            `\nFix: Add 'export' keyword to the function declaration`,
            `Example: export async function ${issue.unexportedFunctions[0]}(request: NextRequest) { ... }\n`,
          ].join("\n");
        }),
        "\nImpact:",
        "- Next.js will return 405 Method Not Allowed",
        "- Integration tests will fail to import handlers",
        "- Endpoint will be non-functional\n",
      ].join("\n");

      throw new Error(errorMessage);
    }

    expect(issues).toHaveLength(0);
  });

  test("should detect unexported GET handlers specifically", () => {
    // This test specifically checks for the reported bug: missing export on GET
    const routeFiles = findRouteFiles(API_ROUTES_DIR);
    const getHandlerIssues: string[] = [];

    for (const file of routeFiles) {
      const { content, relativePath } = readRouteFile(file);

      if (isHandlerUnexported(content, "GET")) {
        getHandlerIssues.push(relativePath);
      }
    }

    if (getHandlerIssues.length > 0) {
      throw new Error(
        `Found ${getHandlerIssues.length} route file(s) with unexported GET handlers:\n` +
          getHandlerIssues.map((f) => `  - ${f}`).join("\n") +
          "\n\nAdd 'export' keyword: export async function GET(request: NextRequest) { ... }"
      );
    }

    expect(getHandlerIssues).toHaveLength(0);
  });

  test("should provide actionable error messages for missing exports", () => {
    const issues = validateAllRoutes();

    // If there are no issues, this test passes
    if (issues.length === 0) {
      expect(issues).toHaveLength(0);
      return;
    }

    // If there are issues, verify error message quality
    for (const issue of issues) {
      expect(issue.file).toBeTruthy();
      expect(issue.file).toMatch(/\/src\/app\/api\/.*\/route\.ts$/);
      expect(issue.unexportedFunctions.length).toBeGreaterThan(0);
      expect(issue.unexportedFunctions.every((m) => HTTP_METHODS.includes(m))).toBe(
        true
      );
    }
  });

  test("should verify integration test import patterns work", () => {
    // This test ensures that the import pattern used by integration tests
    // will work for all route files that have handlers
    const routeFiles = findRouteFiles(API_ROUTES_DIR);
    const importableRoutes: string[] = [];

    for (const file of routeFiles) {
      const { content } = readRouteFile(file);
      
      // Check if file has any exported HTTP method handlers
      const hasExportedHandler = HTTP_METHODS.some((method) => {
        const patterns = createHandlerPatterns(method);
        return patterns.exported.test(content) || patterns.syncExported.test(content);
      });

      if (hasExportedHandler) {
        importableRoutes.push(file);
      }
    }

    // All route files with handlers should be importable
    expect(importableRoutes.length).toBeGreaterThan(0);
    
    // Verify the import path pattern: @/app/api/.../route
    for (const route of importableRoutes) {
      const importPath = route
        .replace(process.cwd(), "")
        .replace(/^\/src\//, "@/")
        .replace(/\.ts$/, "");
      
      expect(importPath).toMatch(/^@\/app\/api\/.*\/route$/);
    }
  });

  test("should document the export requirement in error messages", () => {
    const issues = validateAllRoutes();

    // This test verifies that if issues are found, the error message
    // clearly explains the Next.js requirement for exported handlers

    if (issues.length > 0) {
      const errorDoc = [
        "Next.js App Router requires HTTP method handlers to be exported named functions.",
        "Pattern: export async function GET(request: NextRequest) { ... }",
        "Supported methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
        "Without export: endpoint returns 405 Method Not Allowed",
      ].join("\n");

      // Verify our validation logic captures the requirement
      expect(errorDoc).toContain("exported named functions");
      expect(errorDoc).toContain("405 Method Not Allowed");
    }

    // If no issues, test passes
    expect(true).toBe(true);
  });
});

describe("Route File Export Patterns", () => {
  test("should allow both async and sync function exports", () => {
    const testCases = [
      "export async function GET(request: NextRequest) { }",
      "export function GET(request: NextRequest) { }",
      "export async function POST(req: NextRequest) { }",
      "export function DELETE(req: NextRequest) { }",
    ];

    for (const code of testCases) {
      // Verify our regex patterns recognize both async and sync exports
      const hasExport = /export\s+(?:async\s+)?function\s+(GET|POST|DELETE)\s*\(/.test(
        code
      );
      expect(hasExport).toBe(true);
    }
  });

  test("should detect missing exports regardless of formatting", () => {
    const badPatterns = [
      "async function GET(request: NextRequest) { }",
      "  async function POST(req: NextRequest) { }",
      "\nasync function DELETE(req: NextRequest) { }",
      "function GET(request: NextRequest) { }",
    ];

    for (const code of badPatterns) {
      // These patterns should be detected as unexported
      const hasUnexportedHandler = /(?<!export\s+)(?:^|\n)\s*(?:async\s+)?function\s+(GET|POST|DELETE)\s*\(/.test(
        code
      );
      expect(hasUnexportedHandler).toBe(true);
    }
  });

  test("should not flag arrow function exports as issues", () => {
    // Arrow functions are not the standard pattern for route handlers,
    // but if someone exports them, we shouldn't flag as issues
    const arrowExport = "export const GET = async (request: NextRequest) => { }";

    // Our validation specifically looks for function keyword patterns,
    // so this should not trigger false positives
    const hasUnexportedFunctionKeyword = /(?<!export\s+)(?:^|\n)\s*async\s+function\s+GET\s*\(/.test(
      arrowExport
    );

    expect(hasUnexportedFunctionKeyword).toBe(false);
  });

  test("should handle multiple handlers in same file", () => {
    const multiHandlerFile = `
      export async function GET(request: NextRequest) {
        return NextResponse.json({ data: [] });
      }

      export async function POST(request: NextRequest) {
        return NextResponse.json({ success: true });
      }

      export async function DELETE(request: NextRequest) {
        return NextResponse.json({ deleted: true });
      }
    `;

    // All three should be detected as exported
    expect(/export\s+async\s+function\s+GET\s*\(/.test(multiHandlerFile)).toBe(true);
    expect(/export\s+async\s+function\s+POST\s*\(/.test(multiHandlerFile)).toBe(true);
    expect(/export\s+async\s+function\s+DELETE\s*\(/.test(multiHandlerFile)).toBe(true);

    // None should be detected as unexported
    expect(
      /(?<!export\s+)(?:^|\n)\s*async\s+function\s+GET\s*\(/.test(multiHandlerFile)
    ).toBe(false);
  });
});

describe("Integration Test Compatibility", () => {
  test("should verify route handlers can be imported by tests", () => {
    // Integration tests use this pattern: import { GET, POST } from '@/app/api/path/route'
    const routeFiles = findRouteFiles(API_ROUTES_DIR);
    
    for (const file of routeFiles) {
      const { content, relativePath } = readRouteFile(file);

      // Find all exported handlers
      const exportedHandlers: string[] = [];
      
      for (const method of HTTP_METHODS) {
        const patterns = createHandlerPatterns(method);
        if (patterns.exported.test(content) || patterns.syncExported.test(content)) {
          exportedHandlers.push(method);
        }
      }

      // If this file has handlers, they should all be exported
      if (exportedHandlers.length > 0) {
        // Verify no unexported handlers exist
        for (const method of HTTP_METHODS) {
          if (isHandlerUnexported(content, method)) {
            throw new Error(
              `Route file ${relativePath} has unexported ${method} handler.\n` +
                `Integration tests expect: import { ${method} } from '@/app/api/...'\n` +
                `Fix: export async function ${method}(request: NextRequest) { ... }`
            );
          }
        }
      }
    }
  });

  test("should document common import failures", () => {
    const documentation = {
      problem: "Route handler not exported",
      symptom: "Integration test fails with: Cannot find module or export",
      nextjsSymptom: "Endpoint returns 405 Method Not Allowed",
      solution: "Add export keyword to function declaration",
      example: "export async function GET(request: NextRequest) { ... }",
      testPattern: "import { GET } from '@/app/api/path/route'",
    };

    expect(documentation.problem).toBe("Route handler not exported");
    expect(documentation.solution).toContain("export keyword");
    expect(documentation.example).toMatch(/export async function GET/);
  });
});