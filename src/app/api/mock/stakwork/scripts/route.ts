import { NextRequest, NextResponse } from "next/server";

const mockScripts = [
  {
    id: 1,
    name: "DATA_TRANSFORM_SCRIPT",
    value: "def transform(data):\n    return {k: v.strip() for k, v in data.items() if v}",
    description: "Transforms raw input data by stripping whitespace and removing empty values",
    usage_notation: "{{SCRIPT:DATA_TRANSFORM_SCRIPT}}",
    current_version_id: 3,
    published_version_id: 2,
    version_count: 3,
    created_at: "2024-01-10T08:00:00Z",
    updated_at: "2024-03-05T11:00:00Z",
  },
  {
    id: 2,
    name: "API_RESPONSE_PARSER",
    value: "def parse_response(response):\n    if response.get('success'):\n        return response['data']\n    raise ValueError(response.get('error', 'Unknown error'))",
    description: "Parses Stakwork API responses and extracts data or raises on failure",
    usage_notation: "{{SCRIPT:API_RESPONSE_PARSER}}",
    current_version_id: 5,
    published_version_id: 5,
    version_count: 2,
    created_at: "2024-01-20T09:30:00Z",
    updated_at: "2024-02-28T16:00:00Z",
  },
  {
    id: 3,
    name: "TEXT_SANITIZER",
    value: "import re\n\ndef sanitize(text):\n    return re.sub(r'[<>&\"]', '', text).strip()",
    description: "Removes HTML special characters and trims whitespace from text inputs",
    usage_notation: "{{SCRIPT:TEXT_SANITIZER}}",
    current_version_id: 7,
    published_version_id: 7,
    version_count: 2,
    created_at: "2024-02-05T12:00:00Z",
    updated_at: "2024-03-01T09:15:00Z",
  },
  {
    id: 4,
    name: "WORKFLOW_RESULT_FORMATTER",
    value: "def format_result(result, template):\n    return template.format(**result)",
    description: "Formats workflow results using a provided template string",
    usage_notation: "{{SCRIPT:WORKFLOW_RESULT_FORMATTER}}",
    current_version_id: 9,
    published_version_id: null,
    version_count: 1,
    created_at: "2024-03-01T10:00:00Z",
    updated_at: "2024-03-01T10:00:00Z",
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1");
  const size = parseInt(searchParams.get("size") || "10");
  const search = searchParams.get("search")?.toLowerCase();

  const filtered = search
    ? mockScripts.filter(
        (s) =>
          s.name.toLowerCase().includes(search) ||
          (s.description && s.description.toLowerCase().includes(search))
      )
    : mockScripts;

  return NextResponse.json({
    success: true,
    data: {
      scripts: filtered,
      total: filtered.length,
      size,
      page,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const SCRIPT_NAME_REGEX = /^[A-Z_]+$/;
  if (!body.name || !SCRIPT_NAME_REGEX.test(body.name)) {
    return NextResponse.json(
      { error: "Script name must contain only uppercase letters and underscores" },
      { status: 400 }
    );
  }

  const newScript = {
    id: mockScripts.length + 1,
    name: body.name,
    value: body.value,
    description: body.description || "",
    usage_notation: `{{SCRIPT:${body.name}}}`,
    current_version_id: mockScripts.length + 10,
    published_version_id: null,
    version_count: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  mockScripts.push(newScript);

  return NextResponse.json({ success: true, data: newScript });
}
