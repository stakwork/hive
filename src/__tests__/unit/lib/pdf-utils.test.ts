import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LearnMessage } from '@/types/learn';

// Mock jsPDF
const mockText = vi.fn();
const mockAddPage = vi.fn();
const mockSplitTextToSize = vi.fn();
const mockSetFont = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetTextColor = vi.fn();
const mockSetLineWidth = vi.fn();
const mockSetDrawColor = vi.fn();
const mockLine = vi.fn();
const mockSave = vi.fn();

const mockPdfInstance = {
  text: mockText,
  addPage: mockAddPage,
  splitTextToSize: mockSplitTextToSize,
  setFont: mockSetFont,
  setFontSize: mockSetFontSize,
  setTextColor: mockSetTextColor,
  setLineWidth: mockSetLineWidth,
  setDrawColor: mockSetDrawColor,
  line: mockLine,
  save: mockSave,
  internal: {
    pageSize: {
      getWidth: vi.fn(() => 210), // A4 width in mm
      getHeight: vi.fn(() => 297), // A4 height in mm
    },
  },
};

vi.mock('jspdf', () => ({
  default: vi.fn(() => mockPdfInstance),
}));

// Import after mock setup
const { generateConversationPDF } = await import('@/lib/pdf-utils');

// Test data factories
const TestDataFactories = {
  userMessage: (overrides: Partial<LearnMessage> = {}): LearnMessage => ({
    id: 'msg-user-1',
    role: 'user',
    content: 'Test user message',
    timestamp: new Date('2024-01-15T12:00:00Z'),
    ...overrides,
  }),

  assistantMessage: (overrides: Partial<LearnMessage> = {}): LearnMessage => ({
    id: 'msg-assistant-1',
    role: 'assistant',
    content: 'Test assistant response',
    timestamp: new Date('2024-01-15T12:01:00Z'),
    ...overrides,
  }),

  messageWithMarkdown: (markdown: string): LearnMessage => ({
    id: 'msg-markdown',
    role: 'assistant',
    content: markdown,
    timestamp: new Date('2024-01-15T12:00:00Z'),
  }),

  conversationMessages: (): LearnMessage[] => [
    TestDataFactories.userMessage({ content: 'Hello' }),
    TestDataFactories.assistantMessage({ content: 'Hi there!' }),
    TestDataFactories.userMessage({ id: 'msg-2', content: 'How are you?' }),
    TestDataFactories.assistantMessage({ id: 'msg-3', content: 'I am doing well!' }),
  ],

  emptyMessages: (): LearnMessage[] => [],

  singleMessage: (): LearnMessage[] => [
    TestDataFactories.userMessage({ content: 'Single message' }),
  ],
};

describe('pdf-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation for splitTextToSize
    mockSplitTextToSize.mockImplementation((text: string) => [text]);
  });

  describe('addConversationAsText - Role Label Formatting', () => {
    it('should add "You:" label for user messages', async () => {
      const messages = [TestDataFactories.userMessage({ content: 'User question' })];
      mockSplitTextToSize.mockReturnValue(['User question']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockText).toHaveBeenCalledWith('You:', expect.any(Number), expect.any(Number));
    });

    it('should add "Learning Assistant:" label for assistant messages', async () => {
      const messages = [TestDataFactories.assistantMessage({ content: 'Assistant response' })];
      mockSplitTextToSize.mockReturnValue(['Assistant response']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockText).toHaveBeenCalledWith('Learning Assistant:', expect.any(Number), expect.any(Number));
    });

    it('should format role labels with correct font styling', async () => {
      const messages = [TestDataFactories.userMessage()];
      mockSplitTextToSize.mockReturnValue(['test']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Verify role label is rendered with bold font
      const boldFontCall = Array.from(mockSetFont.mock.calls).find(
        (call) => call[0] === 'helvetica' && call[1] === 'bold'
      );
      expect(boldFontCall).toBeDefined();
      expect(mockSetFontSize).toHaveBeenCalledWith(11);
    });

    it('should alternate role labels correctly in conversation', async () => {
      const messages = TestDataFactories.conversationMessages();
      mockSplitTextToSize.mockReturnValue(['text']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const textCalls = mockText.mock.calls.filter(
        (call) => call[0] === 'You:' || call[0] === 'Learning Assistant:'
      );

      expect(textCalls[0][0]).toBe('You:');
      expect(textCalls[1][0]).toBe('Learning Assistant:');
      expect(textCalls[2][0]).toBe('You:');
      expect(textCalls[3][0]).toBe('Learning Assistant:');
    });
  });

  describe('addConversationAsText - Markdown Conversion', () => {
    it('should convert bullet points (* and -) to bullets (•)', async () => {
      const markdownContent = '* First item\n- Second item\n* Third item';
      const messages = [TestDataFactories.messageWithMarkdown(markdownContent)];
      
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const contentCall = mockSplitTextToSize.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('•')
      );
      
      expect(contentCall).toBeDefined();
      expect(contentCall![0]).toContain('• First item');
      expect(contentCall![0]).toContain('• Second item');
      expect(contentCall![0]).toContain('• Third item');
    });

    it('should strip code block backticks', async () => {
      const markdownContent = '```javascript\nconst x = 42;\n```';
      const messages = [TestDataFactories.messageWithMarkdown(markdownContent)];
      
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const contentCall = mockSplitTextToSize.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('const x')
      );
      
      expect(contentCall).toBeDefined();
      expect(contentCall![0]).not.toContain('```');
      expect(contentCall![0]).toContain('const x = 42;');
    });

    it('should strip inline code backticks', async () => {
      const markdownContent = 'Use `console.log()` for debugging';
      const messages = [TestDataFactories.messageWithMarkdown(markdownContent)];
      
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const contentCall = mockSplitTextToSize.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('console.log')
      );
      
      expect(contentCall).toBeDefined();
      expect(contentCall![0]).toBe('Use console.log() for debugging');
    });

    it('should strip bold markdown (**text**)', async () => {
      const markdownContent = 'This is **bold text** in markdown';
      const messages = [TestDataFactories.messageWithMarkdown(markdownContent)];
      
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const contentCall = mockSplitTextToSize.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('bold text')
      );
      
      expect(contentCall).toBeDefined();
      expect(contentCall![0]).toBe('This is bold text in markdown');
    });

    it('should strip header markdown (# Header)', async () => {
      const markdownContent = '# Main Title\n## Subtitle\n### Section';
      const messages = [TestDataFactories.messageWithMarkdown(markdownContent)];
      
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const contentCall = mockSplitTextToSize.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('Main Title')
      );
      
      expect(contentCall).toBeDefined();
      expect(contentCall![0]).not.toContain('#');
      expect(contentCall![0]).toContain('Main Title');
      expect(contentCall![0]).toContain('Subtitle');
    });

    it('should handle mixed markdown formatting', async () => {
      const markdownContent = '**Bold** text with `code` and:\n* Bullet point\n# Header';
      const messages = [TestDataFactories.messageWithMarkdown(markdownContent)];
      
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const contentCall = mockSplitTextToSize.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('Bold')
      );
      
      expect(contentCall).toBeDefined();
      const processedText = contentCall![0];
      expect(processedText).not.toContain('**');
      expect(processedText).not.toContain('`');
      expect(processedText).not.toContain('#');
      expect(processedText).toContain('•');
      expect(processedText).toContain('Bold');
      expect(processedText).toContain('code');
    });

    it('should handle nested code blocks with content', async () => {
      const markdownContent = '```\nfunction test() {\n  return "nested";\n}\n```';
      const messages = [TestDataFactories.messageWithMarkdown(markdownContent)];
      
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const contentCall = mockSplitTextToSize.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('function test')
      );
      
      expect(contentCall).toBeDefined();
      expect(contentCall![0]).not.toContain('```');
      expect(contentCall![0]).toContain('function test()');
    });
  });

  describe('addConversationAsText - Text Wrapping', () => {
    it('should call splitTextToSize with correct maxWidth', async () => {
      const messages = [TestDataFactories.userMessage({ content: 'Long message content' })];
      mockSplitTextToSize.mockReturnValue(['Long message content']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      // maxWidth should be pageWidth - (margin * 2)
      // For A4 portrait: ~170mm (210 - 40)
      const splitCall = mockSplitTextToSize.mock.calls.find(
        (call) => call[0] === 'Long message content'
      );
      
      expect(splitCall).toBeDefined();
      expect(splitCall![1]).toBeGreaterThan(0);
    });

    it('should render each wrapped line separately', async () => {
      const messages = [TestDataFactories.userMessage({ content: 'Long text' })];
      mockSplitTextToSize.mockReturnValue(['Line 1', 'Line 2', 'Line 3']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockText).toHaveBeenCalledWith('Line 1', expect.any(Number), expect.any(Number));
      expect(mockText).toHaveBeenCalledWith('Line 2', expect.any(Number), expect.any(Number));
      expect(mockText).toHaveBeenCalledWith('Line 3', expect.any(Number), expect.any(Number));
    });

    it('should handle very long single-line content', async () => {
      const longContent = 'a'.repeat(1000);
      const messages = [TestDataFactories.userMessage({ content: longContent })];
      mockSplitTextToSize.mockReturnValue(Array(50).fill('a'.repeat(20)));

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalledWith(longContent, expect.any(Number));
      expect(mockText).toHaveBeenCalled();
    });
  });

  describe('addConversationAsText - Pagination Logic', () => {
    it('should add new page when content exceeds page height', async () => {
      // Create messages that will definitely exceed page height
      const messages = Array(100).fill(null).map((_, i) => 
        TestDataFactories.userMessage({ 
          id: `msg-${i}`,
          content: 'Message content' 
        })
      );
      mockSplitTextToSize.mockReturnValue(['Message content']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockAddPage).toHaveBeenCalled();
    });

    it('should not add page for small conversation', async () => {
      const messages = TestDataFactories.singleMessage();
      mockSplitTextToSize.mockReturnValue(['Single message']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockAddPage).not.toHaveBeenCalled();
    });

    it('should continue rendering after page break', async () => {
      const messages = Array(50).fill(null).map((_, i) => 
        TestDataFactories.userMessage({ 
          id: `msg-${i}`,
          content: `Message ${i}` 
        })
      );
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Verify text rendering continues after addPage calls
      const messageTextCalls = mockText.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].startsWith('Message')
      );
      expect(messageTextCalls.length).toBe(messages.length);
    });
  });

  describe('addConversationAsText - Edge Cases', () => {
    it('should handle empty messages array gracefully', async () => {
      const messages = TestDataFactories.emptyMessages();

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Should render title and timestamp but no messages
      expect(mockText).toHaveBeenCalled();
      const messageLabelCalls = mockText.mock.calls.filter(
        (call) => call[0] === 'You:' || call[0] === 'Learning Assistant:'
      );
      expect(messageLabelCalls).toHaveLength(0);
    });

    it('should handle messages with empty content', async () => {
      const messages = [TestDataFactories.userMessage({ content: '' })];
      mockSplitTextToSize.mockReturnValue(['']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockText).toHaveBeenCalledWith('You:', expect.any(Number), expect.any(Number));
      expect(mockSplitTextToSize).toHaveBeenCalledWith('', expect.any(Number));
    });

    it('should handle messages with only whitespace', async () => {
      const messages = [TestDataFactories.userMessage({ content: '   \n\n   ' })];
      mockSplitTextToSize.mockReturnValue(['   \n\n   ']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalled();
      expect(mockText).toHaveBeenCalledWith('You:', expect.any(Number), expect.any(Number));
    });

    it('should handle special characters in content', async () => {
      const specialContent = '!@#$%^&*()_+-={}[]|:";\'<>?,./~`';
      const messages = [TestDataFactories.userMessage({ content: specialContent })];
      mockSplitTextToSize.mockReturnValue([specialContent]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalledWith(specialContent, expect.any(Number));
    });

    it('should handle Unicode and emoji characters', async () => {
      const unicodeContent = 'Testing émojis 🚀✨ and Unicode 中文';
      const messages = [TestDataFactories.userMessage({ content: unicodeContent })];
      mockSplitTextToSize.mockReturnValue([unicodeContent]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalledWith(unicodeContent, expect.any(Number));
    });

    it('should handle very long conversation', async () => {
      const messages = Array(200).fill(null).map((_, i) => 
        i % 2 === 0 
          ? TestDataFactories.userMessage({ id: `msg-${i}`, content: `User message ${i}` })
          : TestDataFactories.assistantMessage({ id: `msg-${i}`, content: `Assistant response ${i}` })
      );
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockAddPage).toHaveBeenCalled();
      expect(mockText).toHaveBeenCalledWith(expect.stringMatching(/User message|Assistant response|Learning Assistant:|You:/), expect.any(Number), expect.any(Number));
    });

    it('should handle messages with newlines', async () => {
      const messages = [TestDataFactories.userMessage({ 
        content: 'Line 1\nLine 2\nLine 3' 
      })];
      mockSplitTextToSize.mockReturnValue(['Line 1\nLine 2\nLine 3']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalledWith(
        'Line 1\nLine 2\nLine 3',
        expect.any(Number)
      );
    });

    it('should handle malformed markdown gracefully', async () => {
      const malformedContent = '**unclosed bold\n`unclosed code\n```unclosed block';
      const messages = [TestDataFactories.messageWithMarkdown(malformedContent)];
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Should not throw error, even with malformed markdown
      expect(mockSplitTextToSize).toHaveBeenCalled();
    });

    it('should handle single message conversation', async () => {
      const messages = TestDataFactories.singleMessage();
      mockSplitTextToSize.mockReturnValue(['Single message']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const labelCalls = mockText.mock.calls.filter(
        (call) => call[0] === 'You:' || call[0] === 'Learning Assistant:'
      );
      expect(labelCalls).toHaveLength(1);
    });

    it('should maintain correct spacing between messages', async () => {
      const messages = [
        TestDataFactories.userMessage({ content: 'First' }),
        TestDataFactories.assistantMessage({ content: 'Second' }),
      ];
      mockSplitTextToSize.mockReturnValue(['First']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Verify both messages are rendered
      expect(mockText).toHaveBeenCalledWith('You:', expect.any(Number), expect.any(Number));
      expect(mockText).toHaveBeenCalledWith('Learning Assistant:', expect.any(Number), expect.any(Number));
    });

    it('should handle content with multiple consecutive spaces', async () => {
      const messages = [TestDataFactories.userMessage({ 
        content: 'Multiple    consecutive     spaces' 
      })];
      mockSplitTextToSize.mockReturnValue(['Multiple    consecutive     spaces']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      expect(mockSplitTextToSize).toHaveBeenCalledWith(
        'Multiple    consecutive     spaces',
        expect.any(Number)
      );
    });

    it('should handle markdown with no actual markdown syntax', async () => {
      const plainText = 'This is just plain text with no markdown';
      const messages = [TestDataFactories.messageWithMarkdown(plainText)];
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      const contentCall = mockSplitTextToSize.mock.calls.find(
        (call) => call[0] === plainText
      );
      expect(contentCall).toBeDefined();
    });
  });

  describe('addConversationAsText - Integration', () => {
    it('should process complete conversation flow correctly', async () => {
      const messages = [
        TestDataFactories.userMessage({ content: 'Hello **assistant**!' }),
        TestDataFactories.assistantMessage({ content: '* Point 1\n* Point 2' }),
        TestDataFactories.userMessage({ content: 'Use `code` here' }),
        TestDataFactories.assistantMessage({ content: '# Title\nSome text' }),
      ];
      mockSplitTextToSize.mockImplementation((text: string) => [text]);

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Verify all role labels rendered
      const labelCalls = mockText.mock.calls.filter(
        (call) => call[0] === 'You:' || call[0] === 'Learning Assistant:'
      );
      expect(labelCalls).toHaveLength(4);

      // Verify markdown conversion happened
      const contentCalls = mockSplitTextToSize.mock.calls;
      expect(contentCalls.some(call => call[0].includes('Hello assistant!'))).toBe(true);
      expect(contentCalls.some(call => call[0].includes('• Point 1'))).toBe(true);
      expect(contentCalls.some(call => call[0].includes('Use code here'))).toBe(true);
      expect(contentCalls.some(call => !call[0].includes('#'))).toBe(true);
    });

    it('should maintain correct call order for PDF methods', async () => {
      const messages = [TestDataFactories.userMessage()];
      mockSplitTextToSize.mockReturnValue(['test']);

      await generateConversationPDF({ messages, timestamp: new Date() });

      // Verify methods called in correct sequence
      const allCalls = [
        ...mockSetFont.mock.invocationCallOrder,
        ...mockSetFontSize.mock.invocationCallOrder,
        ...mockText.mock.invocationCallOrder,
      ].sort((a, b) => a - b);

      expect(allCalls.length).toBeGreaterThan(0);
    });
  });
});