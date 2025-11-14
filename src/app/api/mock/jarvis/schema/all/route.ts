import { NextRequest, NextResponse } from "next/server";
import type { Schema } from "@/stores/useSchemaStore";

export const runtime = "nodejs";

// Mock data generator for schemas
function generateMockSchemas(): Schema[] {
  const schemas: Schema[] = [
    {
      ref_id: "schema-function",
      type: "Function",
      name: "Function",
      title: "Function",
      description: "Code functions and methods",
      primary_color: "#362429",
      secondary_color: "#D25353",
      icon: "function",
      index: "name",
      node_key: "name",
      attributes: {
        searchable: true,
        indexable: true
      }
    },
    {
      ref_id: "schema-variable",
      type: "Variable",
      name: "Variable",
      title: "Variable",
      description: "Variables and constants",
      primary_color: "#38243C",
      secondary_color: "#F468D4",
      icon: "variable",
      index: "name",
      node_key: "name",
      attributes: {
        searchable: true,
        indexable: true
      }
    },
    {
      ref_id: "schema-person",
      type: "Person",
      name: "Person",
      title: "Person",
      description: "Contributors and team members",
      primary_color: "#302342",
      secondary_color: "#C25AF3",
      icon: "person",
      index: "name",
      node_key: "name",
      attributes: {
        searchable: true,
        indexable: true
      }
    },
    {
      ref_id: "schema-episode",
      type: "Episode",
      name: "Episode",
      title: "Episode",
      description: "Recorded episodes and meetings",
      primary_color: "#2A2545",
      secondary_color: "#9368FB",
      icon: "episode",
      index: "episode_title",
      node_key: "episode_title",
      attributes: {
        searchable: true,
        indexable: true
      }
    },
    {
      ref_id: "schema-clip",
      type: "Clip",
      name: "Clip",
      title: "Clip",
      description: "Audio/video clips and segments",
      primary_color: "#222B48",
      secondary_color: "#5E84F8",
      icon: "clip",
      index: "name",
      node_key: "name",
      attributes: {
        searchable: true,
        indexable: true
      }
    },
    {
      ref_id: "schema-document",
      type: "Document",
      name: "Document",
      title: "Document",
      description: "Documents and files",
      primary_color: "#1D3140",
      secondary_color: "#4FA7D9",
      icon: "document",
      index: "name",
      node_key: "name",
      attributes: {
        searchable: true,
        indexable: true
      }
    },
    {
      ref_id: "schema-topic",
      type: "Topic",
      name: "Topic",
      title: "Topic",
      description: "Discussion topics and themes",
      primary_color: "#1B3134",
      secondary_color: "#21B38A",
      icon: "topic",
      index: "name",
      node_key: "name",
      attributes: {
        searchable: true,
        indexable: true
      }
    },
    {
      ref_id: "schema-class",
      type: "Class",
      name: "Class",
      title: "Class",
      description: "Code classes and structures",
      primary_color: "#22362A",
      secondary_color: "#54AC52",
      icon: "class",
      index: "name",
      node_key: "name",
      attributes: {
        searchable: true,
        indexable: true
      }
    }
  ];

  return schemas;
}

/**
 * Mock endpoint for Jarvis /schema/all
 * Mimics the real jarvis schema endpoint that returns all schema definitions
 */
export async function GET(request: NextRequest) {
  try {
    console.log("[Mock Jarvis Schema/All] Generating mock schema data");

    const schemas = generateMockSchemas();

    // Return data in the format expected by the real API
    return NextResponse.json(schemas, { status: 200 });
  } catch (error) {
    console.error("Error generating mock schema data:", error);
    return NextResponse.json({ error: "Failed to generate mock schema data" }, { status: 500 });
  }
}