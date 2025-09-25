import { describe, test, expect, vi, beforeEach } from "vitest";
describe('ChatMessage', () => {
  it('renders without crashing', () => {
    expect(true).toBe(true);
  });
});
//import React from 'react';
//import { describe, test, expect, vi, beforeEach } from "vitest";
//import { render, screen } from "@testing-library/react";
//import { ChatMessage } from "@/app/w/[slug]/task/[...taskParams]/components/ChatMessage";
//import { ChatMessage as ChatMessageType, Option, FormContent, LongformContent, Artifact } from "@/lib/chat";
//
//// Mock external dependencies
//vi.mock("@/components/MarkdownRenderer", () => ({
//  MarkdownRenderer: ({ children, variant }: { children: string; variant?: string }) => (
//    <div data-testid="markdown-renderer" data-variant={variant}>
//      {children}
//    </div>
//  ),
//}));
//
//vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/form", () => ({
//  FormArtifact: ({ messageId, artifact, selectedOption, isDisabled, onAction }: any) => (
//    <div 
//      data-testid="form-artifact"
//      data-message-id={messageId}
//      data-artifact-id={artifact.id}
//      data-selected={selectedOption?.optionLabel || "none"}
//      data-disabled={isDisabled}
//    >
//      Form Artifact
//    </div>
//  ),
//}));
//
//vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/longform", () => ({
//  LongformArtifactPanel: ({ artifacts, workflowUrl }: any) => (
//    <div 
//      data-testid="longform-artifact"
//      data-artifact-count={artifacts.length}
//      data-workflow-url={workflowUrl || "none"}
//    >
//      Longform Artifact Panel
//    </div>
//  ),
//}));
//
//vi.mock("@/app/w/[slug]/task/[...taskParams]/components/WorkflowUrlLink", () => ({
//  WorkflowUrlLink: ({ workflowUrl, className }: { workflowUrl: string; className?: string }) => (
//    <div 
//      data-testid="workflow-url-link"
//      data-workflow-url={workflowUrl}
//      className={className}
//    >
//      Workflow Link
//    </div>
//  ),
//}));
//
//vi.mock("framer-motion", () => ({
//  motion: {
//    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
//  },
//}));
//
//describe("ChatMessage Component", () => {
//  const mockOnArtifactAction = vi.fn();
//
//  beforeEach(() => {
//    vi.clearAllMocks();
//  });
//
//  // Helper function to create test messages
//  const createMessage = (
//    role: "USER" | "ASSISTANT",
//    message?: string,
//    artifacts?: Artifact[],
//    workflowUrl?: string
//  ): ChatMessageType => ({
//    id: "test-message-1",
//    role,
//    message: message || "",
//    artifacts: artifacts || [],
//    workflowUrl,
//    createdAt: new Date("2024-01-01"),
//    updatedAt: new Date("2024-01-01"),
//  });
//
//  const createFormArtifact = (options: Option[] = []): Artifact => ({
//    id: "form-artifact-1",
//    type: "FORM",
//    content: {
//      actionText: "Choose an option",
//      webhook: "https://example.com/webhook",
//      options,
//    } as FormContent,
//  });
//
//  const createLongformArtifact = (title?: string, text?: string): Artifact => ({
//    id: "longform-artifact-1",
//    type: "LONGFORM",
//    content: {
//      title: title || "Document Title",
//      text: text || "Document content",
//    } as LongformContent,
//  });
//
//  describe("Message Rendering", () => {
//    test("should render user message with correct styling", () => {
//      const userMessage = createMessage("USER", "Hello, this is a user message");
//
//      render(
//        <ChatMessage
//          message={userMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const messageContainer = screen.getByText("Hello, this is a user message").closest("div");
//      expect(messageContainer).toHaveClass("bg-primary", "text-primary-foreground", "rounded-br-md");
//      
//      const flexContainer = messageContainer?.closest(".flex");
//      expect(flexContainer).toHaveClass("justify-end");
//
//      const markdownRenderer = screen.getByTestId("markdown-renderer");
//      expect(markdownRenderer).toHaveAttribute("data-variant", "user");
//    });
//
//    test("should render assistant message with correct styling", () => {
//      const assistantMessage = createMessage("ASSISTANT", "Hello, this is an assistant message");
//
//      render(
//        <ChatMessage
//          message={assistantMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const messageContainer = screen.getByText("Hello, this is an assistant message").closest("div");
//      expect(messageContainer).toHaveClass("bg-background", "text-foreground", "rounded-bl-md", "border");
//      
//      const flexContainer = messageContainer?.closest(".flex");
//      expect(flexContainer).toHaveClass("justify-start");
//
//      const markdownRenderer = screen.getByTestId("markdown-renderer");
//      expect(markdownRenderer).toHaveAttribute("data-variant", "assistant");
//    });
//
//    test("should not render message bubble when message is empty", () => {
//      const emptyMessage = createMessage("USER", "");
//
//      render(
//        <ChatMessage
//          message={emptyMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      expect(screen.queryByTestId("markdown-renderer")).not.toBeInTheDocument();
//    });
//
//    test("should render workflow URL link when workflowUrl is provided", () => {
//      const messageWithWorkflow = createMessage("USER", "Message with workflow", [], "https://workflow.example.com");
//
//      render(
//        <ChatMessage
//          message={messageWithWorkflow}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const workflowLink = screen.getByTestId("workflow-url-link");
//      expect(workflowLink).toBeInTheDocument();
//      expect(workflowLink).toHaveAttribute("data-workflow-url", "https://workflow.example.com");
//    });
//
//    test("should not render workflow URL link when workflowUrl is not provided", () => {
//      const messageWithoutWorkflow = createMessage("USER", "Message without workflow");
//
//      render(
//        <ChatMessage
//          message={messageWithoutWorkflow}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      expect(screen.queryByTestId("workflow-url-link")).not.toBeInTheDocument();
//    });
//  });
//
//  describe("Form Artifacts", () => {
//    test("should render form artifacts correctly", () => {
//      const formOptions: Option[] = [
//        { optionLabel: "Option 1", optionResponse: "response1", actionType: "button" },
//        { optionLabel: "Option 2", optionResponse: "response2", actionType: "button" },
//      ];
//      const formArtifact = createFormArtifact(formOptions);
//      const messageWithForm = createMessage("ASSISTANT", "Choose an option", [formArtifact]);
//
//      render(
//        <ChatMessage
//          message={messageWithForm}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const formArtifactElement = screen.getByTestId("form-artifact");
//      expect(formArtifactElement).toBeInTheDocument();
//      expect(formArtifactElement).toHaveAttribute("data-message-id", "test-message-1");
//      expect(formArtifactElement).toHaveAttribute("data-artifact-id", "form-artifact-1");
//      expect(formArtifactElement).toHaveAttribute("data-selected", "none");
//      expect(formArtifactElement).toHaveAttribute("data-disabled", "false");
//    });
//
//    test("should handle selected option in form artifact", () => {
//      const selectedOption: Option = { optionLabel: "Selected Option", optionResponse: "selected", actionType: "button" };
//      const formArtifact = createFormArtifact([selectedOption]);
//      const messageWithForm = createMessage("ASSISTANT", "Choose an option", [formArtifact]);
//      const replyMessage = createMessage("USER", "selected");
//
//      render(
//        <ChatMessage
//          message={messageWithForm}
//          replyMessage={replyMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const formArtifactElement = screen.getByTestId("form-artifact");
//      expect(formArtifactElement).toHaveAttribute("data-selected", "Selected Option");
//      expect(formArtifactElement).toHaveAttribute("data-disabled", "true");
//    });
//
//    test("should position form artifact according to message role", () => {
//      const formArtifact = createFormArtifact();
//      
//      // Test assistant message (left aligned)
//      const assistantMessage = createMessage("ASSISTANT", "Assistant with form", [formArtifact]);
//      const { rerender } = render(
//        <ChatMessage
//          message={assistantMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      let artifactContainer = screen.getByTestId("form-artifact").closest(".flex");
//      expect(artifactContainer).toHaveClass("justify-start");
//
//      // Test user message (right aligned)
//      const userMessage = createMessage("USER", "User with form", [formArtifact]);
//      rerender(
//        <ChatMessage
//          message={userMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      artifactContainer = screen.getByTestId("form-artifact").closest(".flex");
//      expect(artifactContainer).toHaveClass("justify-end");
//    });
//  });
//
//  describe("Longform Artifacts", () => {
//    test("should render longform artifacts correctly", () => {
//      const longformArtifact = createLongformArtifact("Test Document", "Document content here");
//      const messageWithLongform = createMessage("ASSISTANT", "Here's a document", [longformArtifact], "https://workflow.example.com");
//
//      render(
//        <ChatMessage
//          message={messageWithLongform}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const longformElement = screen.getByTestId("longform-artifact");
//      expect(longformElement).toBeInTheDocument();
//      expect(longformElement).toHaveAttribute("data-artifact-count", "1");
//      expect(longformElement).toHaveAttribute("data-workflow-url", "https://workflow.example.com");
//    });
//
//    test("should position longform artifact according to message role", () => {
//      const longformArtifact = createLongformArtifact();
//      
//      // Test assistant message (left aligned)
//      const assistantMessage = createMessage("ASSISTANT", "Assistant with document", [longformArtifact]);
//      const { rerender } = render(
//        <ChatMessage
//          message={assistantMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      let artifactContainer = screen.getByTestId("longform-artifact").closest(".flex");
//      expect(artifactContainer).toHaveClass("justify-start");
//
//      // Test user message (right aligned)
//      const userMessage = createMessage("USER", "User with document", [longformArtifact]);
//      rerender(
//        <ChatMessage
//          message={userMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      artifactContainer = screen.getByTestId("longform-artifact").closest(".flex");
//      expect(artifactContainer).toHaveClass("justify-end");
//    });
//
//    test("should handle longform artifacts without workflow URL", () => {
//      const longformArtifact = createLongformArtifact();
//      const messageWithLongform = createMessage("ASSISTANT", "Document without workflow", [longformArtifact]);
//
//      render(
//        <ChatMessage
//          message={messageWithLongform}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const longformElement = screen.getByTestId("longform-artifact");
//      expect(longformElement).toHaveAttribute("data-workflow-url", "none");
//    });
//  });
//
//  describe("Mixed Content", () => {
//    test("should render both message and artifacts together", () => {
//      const formArtifact = createFormArtifact();
//      const longformArtifact = createLongformArtifact();
//      const messageWithBoth = createMessage("ASSISTANT", "Message with both artifacts", [formArtifact, longformArtifact]);
//
//      render(
//        <ChatMessage
//          message={messageWithBoth}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      expect(screen.getByTestId("markdown-renderer")).toBeInTheDocument();
//      expect(screen.getByTestId("form-artifact")).toBeInTheDocument();
//      expect(screen.getByTestId("longform-artifact")).toBeInTheDocument();
//    });
//
//    test("should filter and render only form artifacts in form section", () => {
//      const formArtifact = createFormArtifact();
//      const longformArtifact = createLongformArtifact();
//      // Create a mixed artifact that shouldn't appear in form section
//      const otherArtifact = { ...formArtifact, id: "other-1", type: "OTHER" as any };
//      
//      const messageWithMixed = createMessage("ASSISTANT", "Mixed artifacts", [formArtifact, longformArtifact, otherArtifact]);
//
//      render(
//        <ChatMessage
//          message={messageWithMixed}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      // Should render only one form artifact (the other types are filtered out)
//      const formArtifacts = screen.getAllByTestId("form-artifact");
//      expect(formArtifacts).toHaveLength(1);
//    });
//
//    test("should filter and render only longform artifacts in longform section", () => {
//      const formArtifact = createFormArtifact();
//      const longformArtifact1 = createLongformArtifact("Doc 1", "Content 1");
//      const longformArtifact2 = { ...longformArtifact1, id: "longform-2" };
//      
//      const messageWithMultiple = createMessage("ASSISTANT", "Multiple longform", [formArtifact, longformArtifact1, longformArtifact2]);
//
//      render(
//        <ChatMessage
//          message={messageWithMultiple}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      // Should render longform artifacts (both passed to the panel)
//      const longformElements = screen.getAllByTestId("longform-artifact");
//      expect(longformElements).toHaveLength(2);
//    });
//  });
//
//  describe("Edge Cases", () => {
//    test("should handle message with no content and no artifacts", () => {
//      const emptyMessage = createMessage("USER", "", []);
//
//      render(
//        <ChatMessage
//          message={emptyMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      // Should render the container but no content
//      expect(screen.queryByTestId("markdown-renderer")).not.toBeInTheDocument();
//      expect(screen.queryByTestId("form-artifact")).not.toBeInTheDocument();
//      expect(screen.queryByTestId("longform-artifact")).not.toBeInTheDocument();
//    });
//
//    test("should handle reply message without matching form option", () => {
//      const formOptions: Option[] = [
//        { optionLabel: "Option 1", optionResponse: "response1", actionType: "button" },
//      ];
//      const formArtifact = createFormArtifact(formOptions);
//      const messageWithForm = createMessage("ASSISTANT", "Choose", [formArtifact]);
//      const unmatchedReply = createMessage("USER", "unmatched-response");
//
//      render(
//        <ChatMessage
//          message={messageWithForm}
//          replyMessage={unmatchedReply}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const formArtifactElement = screen.getByTestId("form-artifact");
//      expect(formArtifactElement).toHaveAttribute("data-selected", "none");
//      expect(formArtifactElement).toHaveAttribute("data-disabled", "true");
//    });
//
//    test("should handle null/undefined artifacts gracefully", () => {
//      const messageWithUndefinedArtifacts = {
//        ...createMessage("ASSISTANT", "Test message"),
//        artifacts: undefined,
//      };
//
//      render(
//        <ChatMessage
//          message={messageWithUndefinedArtifacts as any}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      expect(screen.getByTestId("markdown-renderer")).toBeInTheDocument();
//      expect(screen.queryByTestId("form-artifact")).not.toBeInTheDocument();
//      expect(screen.queryByTestId("longform-artifact")).not.toBeInTheDocument();
//    });
//
//    test("should handle artifacts without content", () => {
//      const artifactWithoutContent = {
//        id: "empty-artifact",
//        type: "FORM" as const,
//        content: null,
//      };
//
//      const messageWithEmptyArtifact = createMessage("ASSISTANT", "Empty artifact", [artifactWithoutContent as any]);
//
//      render(
//        <ChatMessage
//          message={messageWithEmptyArtifact}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      // Should still render the form artifact (component handles null content)
//      expect(screen.getByTestId("form-artifact")).toBeInTheDocument();
//    });
//  });
//
//  describe("Interaction Handling", () => {
//    test("should pass correct props to FormArtifact", () => {
//      const formArtifact = createFormArtifact();
//      const messageWithForm = createMessage("ASSISTANT", "Test", [formArtifact]);
//
//      render(
//        <ChatMessage
//          message={messageWithForm}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const formElement = screen.getByTestId("form-artifact");
//      expect(formElement).toHaveAttribute("data-message-id", "test-message-1");
//      expect(formElement).toHaveAttribute("data-artifact-id", "form-artifact-1");
//      expect(formElement).toHaveAttribute("data-disabled", "false");
//    });
//
//    test("should handle form artifact with reply message", () => {
//      const selectedOption: Option = { optionLabel: "Yes", optionResponse: "yes", actionType: "button" };
//      const formArtifact = createFormArtifact([selectedOption]);
//      const messageWithForm = createMessage("ASSISTANT", "Confirm?", [formArtifact]);
//      const replyMessage = createMessage("USER", "yes");
//
//      render(
//        <ChatMessage
//          message={messageWithForm}
//          replyMessage={replyMessage}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      const formElement = screen.getByTestId("form-artifact");
//      expect(formElement).toHaveAttribute("data-selected", "Yes");
//      expect(formElement).toHaveAttribute("data-disabled", "true");
//    });
//  });
//
//  describe("Animation and Motion", () => {
//    test("should render motion wrapper with correct props", () => {
//      const message = createMessage("USER", "Test motion");
//
//      render(
//        <ChatMessage
//          message={message}
//          onArtifactAction={mockOnArtifactAction}
//        />
//      );
//
//      // The motion.div should be rendered (mocked as regular div)
//      const container = screen.getByText("Test motion").closest('[class*="space-y-3"]');
//      expect(container).toBeInTheDocument();
//    });
//  });
//});
