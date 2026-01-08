"use client";

import { useState } from "react";
import { ClarifyingQuestionsPreview } from "@/components/features/ClarifyingQuestionsPreview";
import type { ClarifyingQuestion } from "@/types/stakwork";

const exampleQuestions: ClarifyingQuestion[] = [
  {
    question: "What type of app should we build?",
    type: "single_choice",
    options: ["Web", "Mobile", "Desktop"],
  },
  {
    question: "Which primary color for your brand?",
    type: "single_choice",
    options: ["Sky Blue", "Purple", "Emerald"],
    questionArtifact: {
      type: "color_swatch",
      data: [
        { label: "Sky Blue", value: "#0EA5E9" },
        { label: "Purple", value: "#8B5CF6" },
        { label: "Emerald", value: "#10B981" },
      ],
    },
  },
  {
    question: "Does this authentication flow look correct?",
    type: "single_choice",
    options: ["Yes, proceed", "No, needs changes"],
    questionArtifact: {
      type: "mermaid",
      data: "graph TD\n  A[Login Page]-->B{Valid Credentials?}\n  B-->|Yes|C[Dashboard]\n  B-->|No|D[Error Message]\n  D-->A",
    },
  },
  {
    question: "Which real-time approach should we use?",
    type: "single_choice",
    options: ["SSE", "WebSockets", "Polling"],
    questionArtifact: {
      type: "comparison_table",
      data: {
        columns: [
          { label: "SSE", description: "Server-Sent Events" },
          { label: "WebSockets", description: "Full duplex communication" },
          { label: "Polling", description: "Regular HTTP requests" },
        ],
        rows: [
          {
            category: "Pros",
            cells: {
              SSE: ["Simple to implement", "Auto-reconnect built-in", "Works over HTTP"],
              WebSockets: ["Bi-directional", "Low latency", "Real-time updates"],
              Polling: ["Works everywhere", "Simple fallback", "No special server support"],
            },
          },
          {
            category: "Cons",
            cells: {
              SSE: ["Server to client only", "Limited browser support", "No binary data"],
              WebSockets: ["More complex setup", "Requires special server", "Can be blocked by proxies"],
              Polling: ["High latency", "Increased server load", "Inefficient"],
            },
          },
          {
            category: "Use When",
            cells: {
              SSE: ["Live feeds", "Notifications", "Log streaming"],
              WebSockets: ["Chat applications", "Gaming", "Collaborative editing"],
              Polling: ["Legacy systems", "Simple status checks", "Low-frequency updates"],
            },
          },
        ],
      },
    },
  },
  {
    question: "Any additional features you'd like?",
    type: "multiple_choice",
    options: ["Dark mode", "Offline support", "Export to PDF", "Email notifications"],
  },
];

export default function ClarifyingQuestionsTestPage() {
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (formattedAnswers: string) => {
    setIsLoading(true);
    setAnswers(formattedAnswers);

    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setSubmitted(true);
    }, 1000);
  };

  const handleReset = () => {
    setSubmitted(false);
    setAnswers("");
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Clarifying Questions Test Page</h1>
          <p className="text-muted-foreground">
            This page demonstrates all the different types of clarifying questions with artifacts.
          </p>
        </div>

        {!submitted ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-6 space-y-4">
              <h2 className="text-xl font-semibold">Examples Included:</h2>
              <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                <li><strong>Basic Question:</strong> Simple string options (Web/Mobile/Desktop)</li>
                <li><strong>Color Picker:</strong> Color swatch artifact with visual color selection</li>
                <li><strong>Diagram Question:</strong> Mermaid diagram showing authentication flow</li>
                <li><strong>Comparison Table:</strong> Side-by-side comparison of real-time approaches</li>
                <li><strong>Multiple Choice:</strong> Select multiple features</li>
              </ul>
            </div>

            <ClarifyingQuestionsPreview
              questions={exampleQuestions}
              onSubmit={handleSubmit}
              isLoading={isLoading}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-6 space-y-4">
              <h2 className="text-xl font-semibold">Submitted Answers:</h2>
              <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-md">
                {answers}
              </pre>
              <button
                onClick={handleReset}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
