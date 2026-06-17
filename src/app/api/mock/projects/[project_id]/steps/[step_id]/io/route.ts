import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      inputs: {
        url: "https://webhook.site/b3b1cb17-b554-46ea-bd6a-acf83f17eccb",
        method: "post",
        output_type: "raw",
        output_filename: "eec7a2c4-b50b-4ce6-b6bc-be443a79c5bf.json",
        raw_input_params: "<<CUSTOM_ENTITY_EXTRACTION_PROMPT>>",
        expected_output_type: "json",
        prompt_ids: [1552],
      },
      outputs: {
        output: {
          response: {},
          headers: {
            server: "nginx",
            "content-type": "application/json",
            "x-request-id": "1b6ace7c-8498-48ee-b6a9-3c72fc14cae3",
            "cache-control": "no-cache, private",
          },
        },
        completion_time: 0.556712943,
      },
    },
  });
}
