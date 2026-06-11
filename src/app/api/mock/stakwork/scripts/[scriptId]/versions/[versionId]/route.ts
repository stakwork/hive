import { NextRequest, NextResponse } from "next/server";

const mockVersionData: Record<number, { id: number; script_id: number; value: string; description: string; created_at: string; created_by: string }> = {
  1: {
    id: 1,
    script_id: 1,
    value: "def transform(data):\n    return {k: v for k, v in data.items()}",
    description: "Initial version — basic pass-through transform",
    created_at: "2024-01-10T08:00:00Z",
    created_by: "Alice Developer",
  },
  2: {
    id: 2,
    script_id: 1,
    value: "def transform(data):\n    result = {}\n    for k, v in data.items():\n        if v:\n            result[k] = v.strip()\n    return result",
    description: "Added null-check and whitespace stripping",
    created_at: "2024-02-10T14:00:00Z",
    created_by: "Bob Engineer",
  },
  3: {
    id: 3,
    script_id: 1,
    value: "def transform(data):\n    return {k: v.strip() for k, v in data.items() if v}",
    description: "Refactored to one-liner dict comprehension",
    created_at: "2024-03-05T11:00:00Z",
    created_by: "Alice Developer",
  },
  4: {
    id: 4,
    script_id: 2,
    value: "def parse_response(response):\n    if not response.get('success'):\n        raise ValueError('Request failed')\n    return response.get('data')",
    description: "Initial response parser",
    created_at: "2024-01-20T09:30:00Z",
    created_by: "Charlie Tech Lead",
  },
  5: {
    id: 5,
    script_id: 2,
    value: "def parse_response(response):\n    if response.get('success'):\n        return response['data']\n    raise ValueError(response.get('error', 'Unknown error'))",
    description: "Improved error message from response body",
    created_at: "2024-02-28T16:00:00Z",
    created_by: "Charlie Tech Lead",
  },
  6: {
    id: 6,
    script_id: 3,
    value: "def sanitize(text):\n    for char in ['<', '>', '&', '\"']:\n        text = text.replace(char, '')\n    return text.strip()",
    description: "Initial sanitizer using replace loop",
    created_at: "2024-02-05T12:00:00Z",
    created_by: "Dana Security",
  },
  7: {
    id: 7,
    script_id: 3,
    value: "import re\n\ndef sanitize(text):\n    return re.sub(r'[<>&\"]', '', text).strip()",
    description: "Switched to regex for performance",
    created_at: "2024-03-01T09:15:00Z",
    created_by: "Dana Security",
  },
  9: {
    id: 9,
    script_id: 4,
    value: "def format_result(result, template):\n    return template.format(**result)",
    description: "Initial formatter using Python str.format",
    created_at: "2024-03-01T10:00:00Z",
    created_by: "Eve PM",
  },
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string; versionId: string }> }
) {
  try {
    const { versionId } = await params;
    const id = parseInt(versionId);

    const version = mockVersionData[id];

    if (!version) {
      return NextResponse.json(
        { success: false, error: "Version not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: version });
  } catch (error) {
    console.error("Error fetching mock script version:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch version" },
      { status: 500 }
    );
  }
}
