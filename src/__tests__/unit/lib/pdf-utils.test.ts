import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestLearnMessage } from "@/__tests__/support/fixtures/test-message";

// Mock jsPDF at module level
const mockAddPage = vi.fn();
const mockSetFont = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetTextColor = vi.fn();
const mockText = vi.fn();
const mockSplitTextToSize = vi.fn();
const mockSetLineWidth = vi.fn();
const mockSetDrawColor = vi.fn();
const mockLine = vi.fn();
const mockSave = vi.fn();

vi.mock("jspdf", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      internal: {
        pageSize: {
          getWidth: () => 210, // A4 width in mm
          getHeight: () => 297, // A4 height in mm
        },
      },
      addPage: mockAddPage,
      setFont: mockSetFont,
      setFontSize: mockSetFontSize,
      setTextColor: mockSetTextColor,
      text: mockText,
      splitTextToSize: mockSplitTextToSize,
      setLineWidth: mockSetLineWidth,
      setDrawColor: mockSetDrawColor,
      line: mockLine,
      save: mockSave,
    })),
  };
});

// Import after mocking
import { generateConversationPDF } from "@/lib/pdf-utils";

describe("PDF Utils - addConversationAsText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock behavior for splitTextToSize (returns single line)
    mockSplitTextToSize.mockImplementation((text: string) => [text]);
  });

  describe("Message Formatting", () => {
    it("should render user message with 'You:' label", async () => {
      const messages = [
        createTestLearnMessage({ role: "user", content: "Hello" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Find the "You:" label call
      const youLabelCall = mockText.mock.calls.find(
        (call) => call[0] === "You:"
      );
      expect(youLabelCall).toBeDefined();
      expect(mockSetFont).toHaveBeenCalledWith("helvetica", "bold");
      expect(mockSetFontSize).toHaveBeenCalledWith(11);
    });

    it("should render assistant message with 'Learning Assistant:' label", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ role: "assistant", content: "Hello back" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const assistantLabelCall = mockText.mock.calls.find(
        (call) => call[0] === "Learning Assistant:"
      );
      expect(assistantLabelCall).toBeDefined();
      expect(mockSetFont).toHaveBeenCalledWith("helvetica", "bold");
    });

    it("should preserve message order in PDF", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ id: "msg-1", role: "user", content: "First" }),
        createTestLearnMessage({ id: "msg-2", role: "assistant", content: "Second" }),
        createTestLearnMessage({ id: "msg-3", role: "user", content: "Third" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const textCalls = mockText.mock.calls.map((call) => call[0]);
      const firstIndex = textCalls.indexOf("First");
      const secondIndex = textCalls.indexOf("Second");
      const thirdIndex = textCalls.indexOf("Third");

      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });

    it("should switch to normal font for message content", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Message content" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // After the role label (bold), content should be normal
      const setFontCalls = mockSetFont.mock.calls;
      expect(setFontCalls).toContainEqual(["helvetica", "bold"]); // Role label
      expect(setFontCalls).toContainEqual(["helvetica", "normal"]); // Content
    });
  });

  describe("Markdown Conversion", () => {
    it("should convert asterisk bullets to bullet symbols", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "* First item\n* Second item" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      const processedContent = splitTextCall?.[0] as string;
      expect(processedContent).toContain("• First item");
      expect(processedContent).toContain("• Second item");
      expect(processedContent).not.toContain("* First item");
    });

    it("should convert dash bullets to bullet symbols", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "- Item one\n- Item two" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      const processedContent = splitTextCall?.[0] as string;
      expect(processedContent).toContain("• Item one");
      expect(processedContent).toContain("• Item two");
    });

    it("should remove triple backticks from code blocks", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "```\nconst x = 1;\n```" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      const processedContent = splitTextCall?.[0] as string;
      expect(processedContent).toContain("const x = 1;");
      expect(processedContent).not.toContain("```");
    });

    it("should preserve code content when removing backticks", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "```javascript\nfunction test() {\n  return true;\n}\n```" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      const processedContent = splitTextCall?.[0] as string;
      expect(processedContent).toContain("function test()");
      expect(processedContent).toContain("return true;");
      expect(processedContent).not.toContain("```");
    });

    it("should remove single backticks from inline code", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Use `const` for constants" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      const processedContent = splitTextCall?.[0] as string;
      expect(processedContent).toBe("Use const for constants");
      expect(processedContent).not.toContain("`");
    });

    it("should remove bold markdown markers", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "This is **important** text" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      const processedContent = splitTextCall?.[0] as string;
      expect(processedContent).toBe("This is important text");
      expect(processedContent).not.toContain("**");
    });

    it("should remove header markdown symbols", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "# Main Title\n## Subtitle\n### Section" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      const processedContent = splitTextCall?.[0] as string;
      expect(processedContent).toContain("Main Title");
      expect(processedContent).toContain("Subtitle");
      expect(processedContent).toContain("Section");
      expect(processedContent).not.toContain("#");
    });

    it("should handle mixed markdown formatting", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({
          content: "# Title\n* **Bold** item\n* Code: `const x = 1`\n```\nfunction test() {}\n```",
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      const processedContent = splitTextCall?.[0] as string;
      expect(processedContent).toContain("Title");
      expect(processedContent).toContain("• Bold item");
      expect(processedContent).toContain("const x = 1");
      expect(processedContent).toContain("function test()");
      expect(processedContent).not.toContain("#");
      expect(processedContent).not.toContain("**");
      expect(processedContent).not.toContain("`");
      expect(processedContent).not.toContain("```");
    });
  });

  describe("Text Wrapping", () => {
    it("should call splitTextToSize with correct maxWidth", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Test message" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // maxWidth = pageWidth - (margin * 2) = 210 - 40 = 170
      expect(mockSplitTextToSize).toHaveBeenCalledWith(
        expect.any(String),
        170
      );
    });

    it("should render each line from splitTextToSize", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Long message" }),
      ];

      // Mock splitTextToSize to return multiple lines
      mockSplitTextToSize.mockReturnValueOnce([
        "Long message that",
        "wraps to multiple",
        "lines in PDF",
      ]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockText).toHaveBeenCalledWith("Long message that", expect.any(Number), expect.any(Number));
      expect(mockText).toHaveBeenCalledWith("wraps to multiple", expect.any(Number), expect.any(Number));
      expect(mockText).toHaveBeenCalledWith("lines in PDF", expect.any(Number), expect.any(Number));
    });

    it("should handle empty lines from splitTextToSize", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Message with breaks" }),
      ];

      mockSplitTextToSize.mockReturnValueOnce([
        "First line",
        "",
        "Third line",
      ]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Should still render empty line
      const emptyLineCall = mockText.mock.calls.find(
        (call) => call[0] === ""
      );
      expect(emptyLineCall).toBeDefined();
    });
  });

  describe("Pagination", () => {
    it("should add new page when message would exceed bottom margin", async () => {
      // Create enough messages to trigger pagination
      const messages: LearnMessage[] = Array.from({ length: 50 }, (_, i) =>
        createTestLearnMessage({
          id: `msg-${i}`,
          content: "Message content",
        })
      );

      // Mock splitTextToSize to return multiple lines per message
      mockSplitTextToSize.mockImplementation(() => [
        "Line 1",
        "Line 2",
        "Line 3",
      ]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      // With 50 messages and 3 lines each, should definitely trigger pagination
      expect(mockAddPage).toHaveBeenCalled();
    });

    it("should add new page when line would exceed bottom margin", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Long message" }),
      ];

      // Mock splitTextToSize to return many lines
      mockSplitTextToSize.mockReturnValueOnce(
        Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`)
      );

      await generateConversationPDF({ messages, timestamp: new Date() });

      // With 60 lines, should trigger pagination
      expect(mockAddPage).toHaveBeenCalled();
    });

    it("should not add page for small number of messages", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ role: "user", content: "Short" }),
        createTestLearnMessage({ role: "assistant", content: "Reply" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Should not need pagination for 2 short messages
      expect(mockAddPage).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty messages array gracefully", async () => {
      const messages: LearnMessage[] = [];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Should still create PDF with title and timestamp, just no messages
      expect(mockSave).toHaveBeenCalled();
      // Should not call splitTextToSize if no messages
      expect(mockSplitTextToSize).not.toHaveBeenCalled();
    });

    it("should handle message with empty content", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalledWith("", 170);
    });

    it("should handle message with whitespace-only content", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "   \n   \t   " }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalled();
      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      expect(splitTextCall?.[0]).toBe("   \n   \t   ");
    });

    it("should handle very long message content", async () => {
      const longContent = "a".repeat(10000);
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: longContent }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalledWith(longContent, 170);
    });

    it("should handle special characters in content", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Special: <>&\"'@#$%^&*()" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      expect(splitTextCall?.[0]).toContain("Special: <>&\"'@#$%^&*()");
    });

    it("should handle Unicode and emoji in content", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Hello 世界 🌍 café" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      expect(splitTextCall?.[0]).toContain("Hello 世界 🌍 café");
    });

    it("should handle message with only markdown syntax", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "**********" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      // String of all asterisks doesn't match the bold regex pattern (needs non-asterisk content)
      // so it remains unchanged
      expect(splitTextCall?.[0]).toBe("**********");
    });

    it("should handle nested markdown structures", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({
          content: "* **Item 1** with `code`\n* **Item 2** with `more code`",
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      const processedContent = splitTextCall?.[0] as string;
      expect(processedContent).toContain("• Item 1 with code");
      expect(processedContent).toContain("• Item 2 with more code");
    });

    it("should handle message with newlines", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Line 1\nLine 2\nLine 3" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalled();
      const splitTextCall = mockSplitTextToSize.mock.calls[0];
      expect(splitTextCall?.[0]).toContain("\n");
    });
  });

  describe("Multiple Messages", () => {
    it("should render multiple messages with proper spacing", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ id: "msg-1", role: "user", content: "Question" }),
        createTestLearnMessage({ id: "msg-2", role: "assistant", content: "Answer" }),
        createTestLearnMessage({ id: "msg-3", role: "user", content: "Follow-up" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Should have 3 role labels
      const youLabels = mockText.mock.calls.filter((call) => call[0] === "You:");
      const assistantLabels = mockText.mock.calls.filter(
        (call) => call[0] === "Learning Assistant:"
      );

      expect(youLabels).toHaveLength(2); // 2 user messages
      expect(assistantLabels).toHaveLength(1); // 1 assistant message
    });

    it("should apply markdown conversion to all messages", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ id: "msg-1", content: "**Bold 1**" }),
        createTestLearnMessage({ id: "msg-2", content: "**Bold 2**" }),
        createTestLearnMessage({ id: "msg-3", content: "**Bold 3**" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // All 3 messages should have bold markers removed
      const splitTextCalls = mockSplitTextToSize.mock.calls;
      expect(splitTextCalls).toHaveLength(3);
      splitTextCalls.forEach((call) => {
        expect(call[0]).not.toContain("**");
      });
    });

    it("should handle alternating user and assistant messages", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ id: "msg-1", role: "user", content: "Q1" }),
        createTestLearnMessage({ id: "msg-2", role: "assistant", content: "A1" }),
        createTestLearnMessage({ id: "msg-3", role: "user", content: "Q2" }),
        createTestLearnMessage({ id: "msg-4", role: "assistant", content: "A2" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const textCalls = mockText.mock.calls.map((call) => call[0]);
      
      // Should alternate role labels
      expect(textCalls).toContain("You:");
      expect(textCalls).toContain("Learning Assistant:");
      
      // Count occurrences
      const youCount = textCalls.filter((text) => text === "You:").length;
      const assistantCount = textCalls.filter(
        (text) => text === "Learning Assistant:"
      ).length;
      
      expect(youCount).toBe(2);
      expect(assistantCount).toBe(2);
    });
  });

  describe("Font and Styling", () => {
    it("should set correct font size for role labels", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Test" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Role label should use font size 11
      const setFontSizeCalls = mockSetFontSize.mock.calls;
      expect(setFontSizeCalls).toContainEqual([11]);
    });

    it("should set correct font size for message content", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Test" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Message content should use font size 10
      const setFontSizeCalls = mockSetFontSize.mock.calls;
      expect(setFontSizeCalls).toContainEqual([10]);
    });

    it("should set black text color for messages", async () => {
      const messages: LearnMessage[] = [
        createTestLearnMessage({ content: "Test" }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Should set black color (0, 0, 0)
      expect(mockSetTextColor).toHaveBeenCalledWith(0, 0, 0);
    });
  });
});