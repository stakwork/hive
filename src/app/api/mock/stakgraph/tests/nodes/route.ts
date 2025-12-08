import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Tests/Nodes Endpoint
 *
 * Simulates: GET https://{swarm}:7799/tests/nodes
 *
 * Returns mock coverage data for testing the inventory table UI.
 */

const mockEndpoints = [
  { name: "GET /api/users", file: "src/routes/users.ts", ref_id: "endpoint-1", weight: 85, test_count: 3, covered: true, body_length: 45, line_count: 12, verb: "GET" },
  { name: "POST /api/users", file: "src/routes/users.ts", ref_id: "endpoint-2", weight: 90, test_count: 5, covered: true, body_length: 120, line_count: 35, verb: "POST" },
  { name: "GET /api/users/:id", file: "src/routes/users.ts", ref_id: "endpoint-3", weight: 75, test_count: 2, covered: true, body_length: 30, line_count: 8, verb: "GET" },
  { name: "PUT /api/users/:id", file: "src/routes/users.ts", ref_id: "endpoint-4", weight: 60, test_count: 0, covered: false, body_length: 80, line_count: 22, verb: "PUT" },
  { name: "DELETE /api/users/:id", file: "src/routes/users.ts", ref_id: "endpoint-5", weight: 40, test_count: 0, covered: false, body_length: 25, line_count: 6, verb: "DELETE" },
  { name: "GET /api/products", file: "src/routes/products.ts", ref_id: "endpoint-6", weight: 95, test_count: 8, covered: true, body_length: 150, line_count: 45, verb: "GET" },
  { name: "POST /api/products", file: "src/routes/products.ts", ref_id: "endpoint-7", weight: 88, test_count: 4, covered: true, body_length: 200, line_count: 60, verb: "POST" },
  { name: "GET /api/products/:id", file: "src/routes/products.ts", ref_id: "endpoint-8", weight: 70, test_count: 1, covered: true, body_length: 35, line_count: 10, verb: "GET" },
  { name: "PATCH /api/products/:id", file: "src/routes/products.ts", ref_id: "endpoint-9", weight: 55, test_count: 0, covered: false, body_length: 90, line_count: 28, verb: "PATCH" },
  { name: "GET /api/orders", file: "src/routes/orders.ts", ref_id: "endpoint-10", weight: 92, test_count: 6, covered: true, body_length: 180, line_count: 55, verb: "GET" },
  { name: "POST /api/orders", file: "src/routes/orders.ts", ref_id: "endpoint-11", weight: 98, test_count: 10, covered: true, body_length: 350, line_count: 95, verb: "POST" },
  { name: "GET /api/orders/:id", file: "src/routes/orders.ts", ref_id: "endpoint-12", weight: 65, test_count: 2, covered: true, body_length: 40, line_count: 12, verb: "GET" },
  { name: "PUT /api/orders/:id/status", file: "src/routes/orders.ts", ref_id: "endpoint-13", weight: 50, test_count: 0, covered: false, body_length: 60, line_count: 18, verb: "PUT" },
  { name: "GET /api/auth/me", file: "src/routes/auth.ts", ref_id: "endpoint-14", weight: 80, test_count: 4, covered: true, body_length: 55, line_count: 15, verb: "GET" },
  { name: "POST /api/auth/login", file: "src/routes/auth.ts", ref_id: "endpoint-15", weight: 100, test_count: 12, covered: true, body_length: 200, line_count: 55, verb: "POST" },
];

const mockFunctions = [
  { name: "validateUser", file: "src/utils/validation.ts", ref_id: "func-1", weight: 90, test_count: 8, covered: true, body_length: 120, line_count: 35 },
  { name: "hashPassword", file: "src/utils/crypto.ts", ref_id: "func-2", weight: 95, test_count: 5, covered: true, body_length: 45, line_count: 12 },
  { name: "generateToken", file: "src/utils/crypto.ts", ref_id: "func-3", weight: 85, test_count: 3, covered: true, body_length: 60, line_count: 18 },
  { name: "parseQueryParams", file: "src/utils/helpers.ts", ref_id: "func-4", weight: 70, test_count: 0, covered: false, body_length: 80, line_count: 25 },
  { name: "formatResponse", file: "src/utils/helpers.ts", ref_id: "func-5", weight: 65, test_count: 0, covered: false, body_length: 30, line_count: 8 },
  { name: "calculateTotal", file: "src/services/orders.ts", ref_id: "func-6", weight: 88, test_count: 6, covered: true, body_length: 150, line_count: 42 },
  { name: "applyDiscount", file: "src/services/orders.ts", ref_id: "func-7", weight: 75, test_count: 2, covered: true, body_length: 90, line_count: 28 },
  { name: "sendEmail", file: "src/services/notifications.ts", ref_id: "func-8", weight: 60, test_count: 0, covered: false, body_length: 200, line_count: 55 },
  { name: "logActivity", file: "src/services/logging.ts", ref_id: "func-9", weight: 50, test_count: 0, covered: false, body_length: 40, line_count: 12 },
  { name: "connectDatabase", file: "src/db/connection.ts", ref_id: "func-10", weight: 100, test_count: 4, covered: true, body_length: 100, line_count: 30 },
  { name: "runMigrations", file: "src/db/migrations.ts", ref_id: "func-11", weight: 92, test_count: 3, covered: true, body_length: 180, line_count: 50 },
  { name: "seedDatabase", file: "src/db/seed.ts", ref_id: "func-12", weight: 45, test_count: 0, covered: false, body_length: 300, line_count: 85 },
];

const mockClasses = [
  { name: "UserService", file: "src/services/UserService.ts", ref_id: "class-1", weight: 95, test_count: 15, covered: true, body_length: 500, line_count: 150 },
  { name: "OrderService", file: "src/services/OrderService.ts", ref_id: "class-2", weight: 90, test_count: 12, covered: true, body_length: 600, line_count: 180 },
  { name: "ProductService", file: "src/services/ProductService.ts", ref_id: "class-3", weight: 85, test_count: 8, covered: true, body_length: 400, line_count: 120 },
  { name: "AuthController", file: "src/controllers/AuthController.ts", ref_id: "class-4", weight: 100, test_count: 20, covered: true, body_length: 350, line_count: 100 },
  { name: "DatabaseManager", file: "src/db/DatabaseManager.ts", ref_id: "class-5", weight: 80, test_count: 5, covered: true, body_length: 450, line_count: 130 },
  { name: "CacheService", file: "src/services/CacheService.ts", ref_id: "class-6", weight: 70, test_count: 0, covered: false, body_length: 250, line_count: 75 },
  { name: "EmailService", file: "src/services/EmailService.ts", ref_id: "class-7", weight: 65, test_count: 0, covered: false, body_length: 300, line_count: 90 },
  { name: "LoggingService", file: "src/services/LoggingService.ts", ref_id: "class-8", weight: 55, test_count: 0, covered: false, body_length: 200, line_count: 60 },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const nodeType = searchParams.get("node_type") || "endpoint";
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 20)));
  const offset = Math.max(0, Number(searchParams.get("offset") || 0));
  const coverage = searchParams.get("coverage") || "all";
  const search = searchParams.get("search") || "";
  const sort = searchParams.get("sort") || "test_count";

  let items = nodeType === "endpoint"
    ? mockEndpoints
    : nodeType === "function"
      ? mockFunctions
      : mockClasses;

  // Filter by coverage
  if (coverage === "tested") {
    items = items.filter(item => item.covered);
  } else if (coverage === "untested") {
    items = items.filter(item => !item.covered);
  }

  // Filter by search
  if (search) {
    const searchLower = search.toLowerCase();
    items = items.filter(item =>
      item.name.toLowerCase().includes(searchLower) ||
      item.file.toLowerCase().includes(searchLower)
    );
  }

  // Sort
  if (sort === "test_count") {
    items = [...items].sort((a, b) => b.test_count - a.test_count);
  } else if (sort === "weight") {
    items = [...items].sort((a, b) => b.weight - a.weight);
  } else if (sort === "body_length") {
    items = [...items].sort((a, b) => (b.body_length || 0) - (a.body_length || 0));
  } else if (sort === "line_count") {
    items = [...items].sort((a, b) => (b.line_count || 0) - (a.line_count || 0));
  }

  const total_count = items.length;
  const paginatedItems = items.slice(offset, offset + limit);

  return NextResponse.json({
    items: paginatedItems,
    total_count,
    total_returned: paginatedItems.length,
    current_page: Math.floor(offset / limit) + 1,
    total_pages: Math.ceil(total_count / limit),
  });
}
