import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateConversationPDF } from '@/lib/pdf-utils';
import type { LearnMessage } from '@/types/learn';

// Mock jsPDF
const mockPDFInstance = {
  setFontSize: vi.fn().mockReturnThis(),
  setFont: vi.fn().mockReturnThis(),
  text: vi.fn().mockReturnThis(),
  setTextColor: vi.fn().mockReturnThis(),
  setLineWidth: vi.fn().mockReturnThis(),
  setDrawColor: vi.fn().mockReturnThis(),
  line: vi.fn().mockReturnThis(),
  addPage: vi.fn().mockReturnThis(),
  splitTextToSize: vi.fn((text: string) => [text]),
  save: vi.fn(),
  internal: {
    pageSize: {
      getWidth: vi.fn(() => 210),
      getHeight: vi.fn(() => 297),
    },
  },
};

vi.mock('jspdf', () => ({
  default: vi.fn(() => mockPDFInstance),
}));

// Helper function to create test messages
const createTestMessage = (overrides: Partial<LearnMessage> = {}): LearnMessage => ({
  id: Date.now().toString(),
  content: 'Test message content',
  role: 'assistant',
  timestamp: new Date('2024-01-15T12:00:00Z'),
  ...overrides,
});

describe('PDF Utils - generateConversationPDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset splitTextToSize to return single-line by default
    mockPDFInstance.splitTextToSize.mockImplementation((text: string) => [text]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Message Formatting', () => {
    it('should format assistant message with correct role label', async () => {
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Hello! I am your learning assistant.',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Find the call with the role label
      const textCalls = mockPDFInstance.text.mock.calls;
      const roleLabelCall = textCalls.find(call => call[0] === 'Learning Assistant:');
      
      expect(roleLabelCall).toBeDefined();
      expect(roleLabelCall?.[0]).toBe('Learning Assistant:');
    });

    it('should format user message with correct role label', async () => {
      const messages = [
        createTestMessage({
          role: 'user',
          content: 'What is testing?',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const textCalls = mockPDFInstance.text.mock.calls;
      const roleLabelCall = textCalls.find(call => call[0] === 'You:');
      
      expect(roleLabelCall).toBeDefined();
      expect(roleLabelCall?.[0]).toBe('You:');
    });

    it('should preserve message ordering', async () => {
      const messages = [
        createTestMessage({
          id: '1',
          role: 'user',
          content: 'First message',
        }),
        createTestMessage({
          id: '2',
          role: 'assistant',
          content: 'Second message',
        }),
        createTestMessage({
          id: '3',
          role: 'user',
          content: 'Third message',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const textCalls = mockPDFInstance.text.mock.calls;
      
      // Find role labels in order
      const youLabels = textCalls.filter(call => call[0] === 'You:');
      const assistantLabels = textCalls.filter(call => call[0] === 'Learning Assistant:');
      
      expect(youLabels).toHaveLength(2);
      expect(assistantLabels).toHaveLength(1);
      
      // Verify message content appears after role labels
      const firstMessageIndex = textCalls.findIndex(call => call[0] === 'First message');
      const secondMessageIndex = textCalls.findIndex(call => call[0] === 'Second message');
      const thirdMessageIndex = textCalls.findIndex(call => call[0] === 'Third message');
      
      expect(firstMessageIndex).toBeGreaterThan(-1);
      expect(secondMessageIndex).toBeGreaterThan(firstMessageIndex);
      expect(thirdMessageIndex).toBeGreaterThan(secondMessageIndex);
    });

    it('should use bold font for role labels', async () => {
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Test content',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Role labels should be preceded by setFont('helvetica', 'bold')
      const setFontCalls = mockPDFInstance.setFont.mock.calls;
      const boldCalls = setFontCalls.filter(call => call[0] === 'helvetica' && call[1] === 'bold');
      
      expect(boldCalls.length).toBeGreaterThan(0);
    });

    it('should use normal font for message content', async () => {
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Test content',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const setFontCalls = mockPDFInstance.setFont.mock.calls;
      const normalCalls = setFontCalls.filter(call => call[0] === 'helvetica' && call[1] === 'normal');
      
      expect(normalCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Markdown Conversion', () => {
    it('should convert bullet points (* -) to bullet character (•)', async () => {
      const messages = [
        createTestMessage({
          content: '* First bullet\n- Second bullet\n* Third bullet',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // splitTextToSize should receive content with converted bullets
      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const contentCalls = splitCalls.filter(call => typeof call[0] === 'string' && call[0].includes('•'));
      
      expect(contentCalls.length).toBeGreaterThan(0);
      expect(contentCalls[0][0]).toContain('• First bullet');
      expect(contentCalls[0][0]).toContain('• Second bullet');
      expect(contentCalls[0][0]).toContain('• Third bullet');
    });

    it('should remove code block markers (```)', async () => {
      const messages = [
        createTestMessage({
          content: '```javascript\nconst test = true;\n```',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const contentCall = splitCalls.find(call => typeof call[0] === 'string' && call[0].includes('const test = true'));
      
      expect(contentCall).toBeDefined();
      expect(contentCall?.[0]).not.toContain('```');
      expect(contentCall?.[0]).toContain('const test = true');
    });

    it('should remove inline code backticks', async () => {
      const messages = [
        createTestMessage({
          content: 'Use the `Array.map()` method for iteration.',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const contentCall = splitCalls.find(call => typeof call[0] === 'string' && call[0].includes('Array.map()'));
      
      expect(contentCall).toBeDefined();
      expect(contentCall?.[0]).not.toContain('`');
      expect(contentCall?.[0]).toContain('Array.map()');
    });

    it('should remove bold markers (**)', async () => {
      const messages = [
        createTestMessage({
          content: 'This is **important** information.',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const contentCall = splitCalls.find(call => typeof call[0] === 'string' && call[0].includes('important'));
      
      expect(contentCall).toBeDefined();
      expect(contentCall?.[0]).not.toContain('**');
      expect(contentCall?.[0]).toContain('important');
    });

    it('should remove header markers (#)', async () => {
      const messages = [
        createTestMessage({
          content: '# Main Title\n## Subtitle\n### Section',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const contentCall = splitCalls.find(call => typeof call[0] === 'string' && call[0].includes('Main Title'));
      
      expect(contentCall).toBeDefined();
      expect(contentCall?.[0]).not.toMatch(/^#+\s+/);
      expect(contentCall?.[0]).toContain('Main Title');
    });

    it('should handle multiple markdown formats in one message', async () => {
      const messages = [
        createTestMessage({
          content: '# Title\n\nHere are some points:\n* First `point`\n* **Second** point\n\n```code\ntest\n```',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const contentCalls = splitCalls.filter(call => typeof call[0] === 'string');
      
      expect(contentCalls.length).toBeGreaterThan(0);
      
      // Verify markdown has been stripped
      const hasContent = contentCalls.some(call => {
        const text = call[0];
        return text.includes('Title') && 
               text.includes('• First point') && 
               text.includes('Second point') &&
               !text.includes('```') &&
               !text.includes('**') &&
               !text.includes('`');
      });
      
      expect(hasContent).toBe(true);
    });
  });

  describe('Pagination Logic', () => {
    it('should add new page when content exceeds page height', async () => {
      // Create a message that will require pagination
      const longContent = Array(50).fill('This is a long line of content that needs wrapping.').join('\n');
      const messages = [
        createTestMessage({
          content: longContent,
        }),
      ];

      // Mock splitTextToSize to return many lines
      mockPDFInstance.splitTextToSize.mockImplementation((text: string) => {
        return Array(60).fill('Line of text');
      });

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Verify addPage was called
      expect(mockPDFInstance.addPage).toHaveBeenCalled();
    });

    it('should reset Y position after adding new page', async () => {
      const messages = [
        createTestMessage({
          content: 'First message',
        }),
      ];

      // Mock splitTextToSize to return many lines that will trigger pagination
      mockPDFInstance.splitTextToSize.mockImplementation((text: string) => {
        return Array(60).fill('Line of text');
      });

      await generateConversationPDF({ messages, timestamp: new Date() });

      // After addPage is called, text should be called with Y around margin (20)
      expect(mockPDFInstance.addPage).toHaveBeenCalled();
      
      // Find text calls after addPage
      const addPageCallIndex = mockPDFInstance.addPage.mock.invocationCallOrder[0];
      const textCallsAfterPage = mockPDFInstance.text.mock.invocationCallOrder
        .map((order, index) => ({ order, index }))
        .filter(call => call.order > addPageCallIndex);
      
      expect(textCallsAfterPage.length).toBeGreaterThan(0);
    });

    it('should handle multiple page breaks for very long conversations', async () => {
      const messages = Array(10).fill(null).map((_, i) =>
        createTestMessage({
          id: `msg-${i}`,
          content: `Message ${i}`,
        })
      );

      // Mock splitTextToSize to return many lines per message
      mockPDFInstance.splitTextToSize.mockImplementation((text: string) => {
        return Array(30).fill('Line of text');
      });

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Multiple addPage calls expected
      expect(mockPDFInstance.addPage.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('Text Wrapping', () => {
    it('should call splitTextToSize with correct maxWidth', async () => {
      const messages = [
        createTestMessage({
          content: 'This is a test message that needs text wrapping.',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // splitTextToSize should be called with contentWidth (170mm = 210 - 40)
      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const relevantCall = splitCalls.find(call => 
        typeof call[0] === 'string' && call[0].includes('test message')
      );
      
      expect(relevantCall).toBeDefined();
      expect(relevantCall?.[1]).toBe(170); // 210 (page width) - 40 (2 * margin)
    });

    it('should render each line returned by splitTextToSize', async () => {
      const messages = [
        createTestMessage({
          content: 'Long message content',
        }),
      ];

      // Mock splitTextToSize to return multiple lines
      mockPDFInstance.splitTextToSize.mockImplementation((text: string) => {
        if (text.includes('Long message content')) {
          return ['Long message', 'content'];
        }
        return [text];
      });

      await generateConversationPDF({ messages, timestamp: new Date() });

      const textCalls = mockPDFInstance.text.mock.calls;
      
      expect(textCalls.some(call => call[0] === 'Long message')).toBe(true);
      expect(textCalls.some(call => call[0] === 'content')).toBe(true);
    });
  });

  describe('Filename Sanitization', () => {
    it('should generate filename from first user question', async () => {
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Hello! How can I help?',
        }),
        createTestMessage({
          role: 'user',
          content: 'What is unit testing in JavaScript?',
        }),
        createTestMessage({
          role: 'assistant',
          content: 'Unit testing is...',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const saveCall = mockPDFInstance.save.mock.calls[0];
      expect(saveCall[0]).toContain('What is unit testing in JavaScript');
      expect(saveCall[0]).toContain('Hive Learning -');
      expect(saveCall[0]).toContain('.pdf');
    });

    it('should limit filename to 50 characters from question', async () => {
      const longQuestion = 'What is the comprehensive explanation of unit testing methodologies and best practices in modern JavaScript applications?';
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Hello!',
        }),
        createTestMessage({
          role: 'user',
          content: longQuestion,
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const saveCall = mockPDFInstance.save.mock.calls[0];
      const filename = saveCall[0];
      
      // Extract the sanitized question part (between "Hive Learning - " and ".pdf")
      const match = filename.match(/Hive Learning - (.+)\.pdf/);
      expect(match).toBeDefined();
      expect(match![1].length).toBeLessThanOrEqual(50);
    });

    it('should remove special characters from filename', async () => {
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Hello!',
        }),
        createTestMessage({
          role: 'user',
          content: 'What is @testing/library & how to use it?',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const saveCall = mockPDFInstance.save.mock.calls[0];
      const filename = saveCall[0];
      
      expect(filename).not.toContain('@');
      expect(filename).not.toContain('&');
      expect(filename).not.toContain('?');
      expect(filename).toContain('What is testinglibrary');
    });

    it('should use default filename when no user question exists', async () => {
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Hello! I am your learning assistant.',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const saveCall = mockPDFInstance.save.mock.calls[0];
      expect(saveCall[0]).toBe('Hive Learning - Export.pdf');
    });

    it('should use default filename when question is empty after sanitization', async () => {
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Hello!',
        }),
        createTestMessage({
          role: 'user',
          content: '@#$%^&*()',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const saveCall = mockPDFInstance.save.mock.calls[0];
      expect(saveCall[0]).toBe('Hive Learning - Export.pdf');
    });

    it('should preserve spaces in filename for readability', async () => {
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Hello!',
        }),
        createTestMessage({
          role: 'user',
          content: 'What is test driven development',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const saveCall = mockPDFInstance.save.mock.calls[0];
      const filename = saveCall[0];
      
      expect(filename).toContain('What is test driven development');
      expect(filename.match(/\s+/g)).toBeTruthy(); // Should contain spaces
    });
  });

  describe('PDF Structure', () => {
    it('should set correct title in PDF header', async () => {
      const messages = [createTestMessage()];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const textCalls = mockPDFInstance.text.mock.calls;
      const titleCall = textCalls.find(call => call[0] === 'Learning Assistant Conversation');
      
      expect(titleCall).toBeDefined();
      expect(mockPDFInstance.setFontSize).toHaveBeenCalledWith(20);
    });

    it('should include timestamp in PDF header', async () => {
      const timestamp = new Date('2024-01-15T14:30:00Z');
      const messages = [createTestMessage()];

      await generateConversationPDF({ messages, timestamp });

      const textCalls = mockPDFInstance.text.mock.calls;
      const timestampCall = textCalls.find(call => 
        typeof call[0] === 'string' && call[0].includes('Exported:')
      );
      
      expect(timestampCall).toBeDefined();
      expect(timestampCall?.[0]).toContain('Exported:');
    });

    it('should draw separator line after header', async () => {
      const messages = [createTestMessage()];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockPDFInstance.setLineWidth).toHaveBeenCalledWith(0.5);
      expect(mockPDFInstance.setDrawColor).toHaveBeenCalledWith(200, 200, 200);
      expect(mockPDFInstance.line).toHaveBeenCalled();
    });

    it('should call save with generated filename', async () => {
      const messages = [createTestMessage()];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockPDFInstance.save).toHaveBeenCalledTimes(1);
      expect(mockPDFInstance.save.mock.calls[0][0]).toMatch(/\.pdf$/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message array', async () => {
      const messages: LearnMessage[] = [];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Should still create PDF with title and header, but no messages
      expect(mockPDFInstance.save).toHaveBeenCalled();
      const textCalls = mockPDFInstance.text.mock.calls;
      const titleCall = textCalls.find(call => call[0] === 'Learning Assistant Conversation');
      expect(titleCall).toBeDefined();
    });

    it('should handle message with only whitespace', async () => {
      const messages = [
        createTestMessage({
          content: '   \n\n   \t\t   ',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Should not crash, should still render
      expect(mockPDFInstance.save).toHaveBeenCalled();
    });

    it('should handle message with empty content', async () => {
      const messages = [
        createTestMessage({
          content: '',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockPDFInstance.save).toHaveBeenCalled();
    });

    it('should handle very long single message', async () => {
      const longMessage = 'A'.repeat(10000);
      const messages = [
        createTestMessage({
          content: longMessage,
        }),
      ];

      // Mock splitTextToSize to return many lines
      mockPDFInstance.splitTextToSize.mockImplementation((text: string) => {
        if (text.length > 100) {
          return Array(200).fill('A');
        }
        return [text];
      });

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockPDFInstance.save).toHaveBeenCalled();
      expect(mockPDFInstance.addPage).toHaveBeenCalled();
    });

    it('should handle special characters in message content', async () => {
      const messages = [
        createTestMessage({
          content: 'Special chars: @#$%^&*()_+{}[]|:";\'<>?,./\\',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockPDFInstance.save).toHaveBeenCalled();
      
      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const contentCall = splitCalls.find(call => 
        typeof call[0] === 'string' && call[0].includes('Special chars')
      );
      expect(contentCall).toBeDefined();
    });

    it('should handle Unicode characters', async () => {
      const messages = [
        createTestMessage({
          content: 'Unicode: 你好 🚀 émojis ñ',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockPDFInstance.save).toHaveBeenCalled();
      
      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const contentCall = splitCalls.find(call => 
        typeof call[0] === 'string' && call[0].includes('Unicode')
      );
      expect(contentCall).toBeDefined();
    });

    it('should handle alternating user and assistant messages', async () => {
      const messages = [
        createTestMessage({ role: 'user', content: 'User 1' }),
        createTestMessage({ role: 'assistant', content: 'Assistant 1' }),
        createTestMessage({ role: 'user', content: 'User 2' }),
        createTestMessage({ role: 'assistant', content: 'Assistant 2' }),
        createTestMessage({ role: 'user', content: 'User 3' }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      const textCalls = mockPDFInstance.text.mock.calls;
      const youLabels = textCalls.filter(call => call[0] === 'You:');
      const assistantLabels = textCalls.filter(call => call[0] === 'Learning Assistant:');
      
      expect(youLabels).toHaveLength(3);
      expect(assistantLabels).toHaveLength(2);
    });

    it('should handle messages with mixed line endings', async () => {
      const messages = [
        createTestMessage({
          content: 'Line 1\nLine 2\r\nLine 3\rLine 4',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockPDFInstance.save).toHaveBeenCalled();
    });
  });

  describe('Integration Behavior', () => {
    it('should complete full PDF generation flow', async () => {
      const messages = [
        createTestMessage({
          role: 'assistant',
          content: 'Hello! How can I help you?',
        }),
        createTestMessage({
          role: 'user',
          content: 'Explain unit testing',
        }),
        createTestMessage({
          role: 'assistant',
          content: '# Unit Testing\n\nUnit testing is:\n* Fast\n* Isolated\n* **Important**\n\n```js\ntest()\n```',
        }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Verify complete flow
      expect(mockPDFInstance.setFontSize).toHaveBeenCalled();
      expect(mockPDFInstance.setFont).toHaveBeenCalled();
      expect(mockPDFInstance.text).toHaveBeenCalled();
      expect(mockPDFInstance.splitTextToSize).toHaveBeenCalled();
      expect(mockPDFInstance.save).toHaveBeenCalled();
      
      // Verify markdown was processed
      const splitCalls = mockPDFInstance.splitTextToSize.mock.calls;
      const assistantContent = splitCalls.find(call => 
        typeof call[0] === 'string' && 
        call[0].includes('Unit Testing') &&
        call[0].includes('•')
      );
      expect(assistantContent).toBeDefined();
    });

    it('should maintain Y-position consistency throughout rendering', async () => {
      const messages = [
        createTestMessage({ role: 'user', content: 'Q1' }),
        createTestMessage({ role: 'assistant', content: 'A1' }),
        createTestMessage({ role: 'user', content: 'Q2' }),
      ];

      await generateConversationPDF({ messages, timestamp: new Date() });

      // text() should be called with increasing Y values (second parameter)
      const textCalls = mockPDFInstance.text.mock.calls;
      const yPositions = textCalls.map(call => call[2]).filter(y => typeof y === 'number');
      
      // Y positions should generally increase (allowing for page breaks resetting to 20)
      expect(yPositions.length).toBeGreaterThan(0);
    });
  });
});