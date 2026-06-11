import { NextRequest, NextResponse } from "next/server";

const mockVersions: Record<number, { id: number; script_id: number; value: string; created_at: string; created_by: string }[]> = {
  1: [
    {
      id: 3,
      script_id: 1,
      value: "def transform(data):\n    return {k: v.strip() for k, v in data.items() if v}",
      created_at: "2024-03-05T11:00:00Z",
      created_by: "Alice Developer",
    },
    {
      id: 2,
      script_id: 1,
      value: "def transform(data):\n    result = {}\n    for k, v in data.items():\n        if v:\n            result[k] = v.strip()\n    return result",
      created_at: "2024-02-10T14:00:00Z",
      created_by: "Bob Engineer",
    },
    {
      id: 1,
      script_id: 1,
      value: "def transform(data):\n    return {k: v for k, v in data.items()}",
      created_at: "2024-01-10T08:00:00Z",
      created_by: "Alice Developer",
    },
  ],
  2: [
    {
      id: 5,
      script_id: 2,
      value: "def parse_response(response):\n    if response.get('success'):\n        return response['data']\n    raise ValueError(response.get('error', 'Unknown error'))",
      created_at: "2024-02-28T16:00:00Z",
      created_by: "Charlie Tech Lead",
    },
    {
      id: 4,
      script_id: 2,
      value: "def parse_response(response):\n    if not response.get('success'):\n        raise ValueError('Request failed')\n    return response.get('data')",
      created_at: "2024-01-20T09:30:00Z",
      created_by: "Charlie Tech Lead",
    },
  ],
  3: [
    {
      id: 7,
      script_id: 3,
      value: "import re\n\ndef sanitize(text):\n    return re.sub(r'[<>&\"]', '', text).strip()",
      created_at: "2024-03-01T09:15:00Z",
      created_by: "Dana Security",
    },
    {
      id: 6,
      script_id: 3,
      value: "def sanitize(text):\n    for char in ['<', '>', '&', '\"']:\n        text = text.replace(char, '')\n    return text.strip()",
      created_at: "2024-02-05T12:00:00Z",
      created_by: "Dana Security",
    },
  ],
  4: [
    {
      id: 9,
      script_id: 4,
      value: "def format_result(result, template):\n    return template.format(**result)",
      created_at: "2024-03-01T10:00:00Z",
      created_by: "Eve PM",
    },
  ],
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> }
) {
  try {
    const { scriptId } = await params;
    const id = parseInt(scriptId);

    const versions = mockVersions[id] || [];

    return NextResponse.json({
      success: true,
      data: {
        versions,
        total: versions.length,
      },
    });
  } catch (error) {
    console.error("Error fetching mock script versions:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch versions" },
      { status: 500 }
    );
  }
}
