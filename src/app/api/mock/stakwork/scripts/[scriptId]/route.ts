import { NextRequest, NextResponse } from "next/server";

const mockScripts = new Map([
  [
    1,
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
  ],
  [
    2,
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
  ],
  [
    3,
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
  ],
  [
    4,
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
  ],
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  try {
    const { scriptId } = await params;
    const id = parseInt(scriptId);

    const script = mockScripts.get(id);

    if (!script) {
      return NextResponse.json({ success: false, error: "Script not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: script });
  } catch (error) {
    console.error("Error fetching mock script:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch script" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  try {
    const { scriptId } = await params;
    const id = parseInt(scriptId);
    const body = await request.json();

    const existing = mockScripts.get(id);

    if (!existing) {
      return NextResponse.json({ success: false, error: "Script not found" }, { status: 404 });
    }

    const updated = {
      ...existing,
      value: body.value ?? existing.value,
      description: body.description ?? existing.description,
      current_version_id: (existing.current_version_id ?? 0) + 1,
      updated_at: new Date().toISOString(),
    };

    mockScripts.set(id, updated);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating mock script:", error);
    return NextResponse.json({ success: false, error: "Failed to update script" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  try {
    const { scriptId } = await params;
    const id = parseInt(scriptId);

    if (!mockScripts.has(id)) {
      return NextResponse.json({ success: false, error: "Script not found" }, { status: 404 });
    }

    mockScripts.delete(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting mock script:", error);
    return NextResponse.json({ success: false, error: "Failed to delete script" }, { status: 500 });
  }
}
