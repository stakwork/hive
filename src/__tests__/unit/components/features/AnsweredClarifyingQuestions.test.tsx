// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AnsweredClarifyingQuestions,
} from "@/components/features/ClarifyingQuestionsPreview/AnsweredClarifyingQuestions";
import type { ClarifyingQuestion } from "@/types/stakwork";
import type { ChatMessage as ChatMessageType } from "@/lib/chat";

vi.mock("lucide-react", () => {
  const React = require("react");
  return {
    ChevronDown: ({ className }: any) =>
      React.createElement("span", { "data-testid": "chevron-down", className }),
    ChevronRight: ({ className }: any) =>
      React.createElement("span", { "data-testid": "chevron-right", className }),
    HelpCircle: ({ className }: any) =>
      React.createElement("span", { "data-testid": "help-circle", className }),
  };
});

const baseMessage = (message: string): ChatMessageType =>
  ({
    id: "msg1",
    role: "USER",
    message,
    status: "SENT",
    artifacts: [],
    attachments: [],
    replyId: null,
    createdAt: new Date().toISOString(),
  } as unknown as ChatMessageType);

const questions: ClarifyingQuestion[] = [
  { question: "What is your goal?", type: "text" },
  { question: "What is your timeline?", type: "text" },
];

describe("AnsweredClarifyingQuestions", () => {
  describe("with Q&A formatted pairs", () => {
    const formattedMessage = baseMessage(
      "Q: What is your goal?\nA: Build a better product\n\nQ: What is your timeline?\nA: 3 months",
    );

    it("renders the expandable button with chevron", () => {
      render(
        <AnsweredClarifyingQuestions
          questions={questions}
          replyMessage={formattedMessage}
        />,
      );
      // Should show a button (interactive)
      expect(screen.getByRole("button")).toBeInTheDocument();
      // Chevron present
      expect(screen.getByTestId("chevron-right")).toBeInTheDocument();
      // Summary text
      expect(screen.getByText(/2 questions answered/)).toBeInTheDocument();
    });

    it("expands to show Q&A pairs on click", async () => {
      const user = userEvent.setup();
      render(
        <AnsweredClarifyingQuestions
          questions={questions}
          replyMessage={formattedMessage}
        />,
      );
      await user.click(screen.getByRole("button"));
      expect(screen.getByText("What is your goal?")).toBeInTheDocument();
      expect(screen.getByText("Build a better product")).toBeInTheDocument();
      expect(screen.getByText("What is your timeline?")).toBeInTheDocument();
      expect(screen.getByText("3 months")).toBeInTheDocument();
    });

    it("toggles expanded state on repeated clicks", async () => {
      const user = userEvent.setup();
      render(
        <AnsweredClarifyingQuestions
          questions={questions}
          replyMessage={formattedMessage}
        />,
      );
      const btn = screen.getByRole("button");
      await user.click(btn);
      expect(screen.getByText("Build a better product")).toBeInTheDocument();
      await user.click(btn);
      expect(screen.queryByText("Build a better product")).not.toBeInTheDocument();
    });
  });

  describe("without Q&A formatted pairs (free-form / canvas-agent reply)", () => {
    const freeFormMessage = baseMessage("[via canvas agent] Proceed with option A");

    it("renders a non-interactive div (no button)", () => {
      render(
        <AnsweredClarifyingQuestions
          questions={questions}
          replyMessage={freeFormMessage}
        />,
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("does not render any chevron icon", () => {
      render(
        <AnsweredClarifyingQuestions
          questions={questions}
          replyMessage={freeFormMessage}
        />,
      );
      expect(screen.queryByTestId("chevron-right")).not.toBeInTheDocument();
      expect(screen.queryByTestId("chevron-down")).not.toBeInTheDocument();
    });

    it("shows the HelpCircle icon and answered count", () => {
      render(
        <AnsweredClarifyingQuestions
          questions={questions}
          replyMessage={freeFormMessage}
        />,
      );
      expect(screen.getByTestId("help-circle")).toBeInTheDocument();
      expect(screen.getByText(/2 questions answered/)).toBeInTheDocument();
    });

    it("uses singular 'question' for a single question", () => {
      render(
        <AnsweredClarifyingQuestions
          questions={[questions[0]]}
          replyMessage={freeFormMessage}
        />,
      );
      expect(screen.getByText(/1 question answered/)).toBeInTheDocument();
    });

    it("does not render any Q&A pair content", () => {
      render(
        <AnsweredClarifyingQuestions
          questions={questions}
          replyMessage={freeFormMessage}
        />,
      );
      expect(screen.queryByText("What is your goal?")).not.toBeInTheDocument();
    });
  });
});
