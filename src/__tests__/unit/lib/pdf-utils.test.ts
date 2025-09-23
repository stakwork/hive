import { describe, test, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import { generateConversationPDF } from '@/lib/pdf-utils';
import type { LearnMessage } from '@/types/learn';

// Mock jsPDF
const mockJsPDF = {
  setFontSize: vi.fn().mockReturnThis(),
  setFont: vi.fn().mockReturnThis(),
  text: vi.fn().mockReturnThis(),
  setTextColor: vi.fn().mockReturnThis(),
  setDrawColor: vi.fn().mockReturnThis(),
  setLineWidth: vi.fn().mockReturnThis(),
  line: vi.fn().mockReturnThis(),
  addPage: vi.fn().mockReturnThis(),
  save: vi.fn().mockReturnThis(),
  splitTextToSize: vi.fn().mockImplementation((text: string, maxWidth: number) => {
    // Simple mock implementation - split text into chunks
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    words.forEach(word => {
      if (currentLine.length + word.length + 1 <= maxWidth / 2) { // Rough approximation
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    });
    
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [text];
  }),
  internal: {
    pageSize: {
      getWidth: vi.fn().mockReturnValue(210), // A4 width in mm
      getHeight: vi.fn().mockReturnValue(297), // A4 height in mm
    },
  },
};

vi.mock('jspdf', () => {
  return {
    default: vi.fn().mockImplementation(() => mockJsPDF),
  };
});

describe('pdf-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test data fixtures
  const createTestMessage = (
    role: 'user' | 'assistant',
    content: string,
    id: string = `msg-${Date.now()}`,
    isError: boolean = false
  ): LearnMessage => ({
    id,
    content,
    role,
    timestamp: new Date('2024-01-15T10:30:00Z'),
    isError,
  });

  const basicMessages: LearnMessage[] = [
    createTestMessage('user', 'Hello, can you help me understand React hooks?', 'msg-1'),
    createTestMessage('assistant', 'Of course! React hooks are functions that let you use state and other React features in functional components.', 'msg-2'),
    createTestMessage('user', 'Can you give me an example?', 'msg-3'),
    createTestMessage('assistant', 'Here is a simple example:\n\n```javascript\nimport React, { useState } from "react";\n\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  return (\n    <div>\n      <p>You clicked {count} times</p>\n      <button onClick={() => setCount(count + 1)}>Click me</button>\n    </div>\n  );\n}\n```', 'msg-4'),
  ];

  const markdownMessages: LearnMessage[] = [
    createTestMessage('user', 'Can you explain different formatting options?', 'msg-1'),
    createTestMessage('assistant', 
      'Sure! Here are some formatting options:\n\n' +
      '## Headers\n' +
      'This is a header\n\n' +
      '**Bold text** and regular text\n\n' +
      'Here are some bullet points:\n' +
      '- First point\n' +
      '* Second point\n' +
      '- Third point\n\n' +
      'Inline code: `console.log("hello")`\n\n' +
      'Code block:\n' +
      '```python\n' +
      'def hello():\n' +
      '    print("Hello, world!")\n' +
      '```',
      'msg-2'
    ),
  ];

  describe('generateConversationPDF', () => {
    test('should create PDF with basic conversation', async () => {
      const timestamp = new Date('2024-01-15T14:30:00Z');
      
      await generateConversationPDF({
        messages: basicMessages,
        timestamp,
      });

      // Verify PDF setup
      expect(mockJsPDF.setFontSize).toHaveBeenCalledWith(20);
      expect(mockJsPDF.setFont).toHaveBeenCalledWith('helvetica', 'bold');
      expect(mockJsPDF.text).toHaveBeenCalledWith('Learning Assistant Conversation', 20, 20);

      // Verify timestamp formatting and display
      expect(mockJsPDF.setFontSize).toHaveBeenCalledWith(10);
      expect(mockJsPDF.setFont).toHaveBeenCalledWith('helvetica', 'normal');
      expect(mockJsPDF.setTextColor).toHaveBeenCalledWith(100, 100, 100);
      expect(mockJsPDF.text).toHaveBeenCalledWith('Exported: January 15, 2024 at 02:30 PM', 20, 35);

      // Verify separator line
      expect(mockJsPDF.setLineWidth).toHaveBeenCalledWith(0.5);
      expect(mockJsPDF.setDrawColor).toHaveBeenCalledWith(200, 200, 200);
      expect(mockJsPDF.line).toHaveBeenCalledWith(20, 45, 190, 45);

      // Verify PDF is saved with correct filename based on first user question  
      expect(mockJsPDF.save).toHaveBeenCalledWith('Hive Learning - Hello can you help me understand React hooks.pdf');
    });

    test('should handle empty messages array', async () => {
      const timestamp = new Date('2024-01-15T14:30:00Z');
      
      await generateConversationPDF({
        messages: [],
        timestamp,
      });

      // Should still create PDF with title and timestamp
      expect(mockJsPDF.text).toHaveBeenCalledWith('Learning Assistant Conversation', 20, 20);
      expect(mockJsPDF.text).toHaveBeenCalledWith('Exported: January 15, 2024 at 02:30 PM', 20, 35);
      
      // Should use default filename when no user messages
      expect(mockJsPDF.save).toHaveBeenCalledWith('Hive Learning - Export.pdf');
    });

    test('should use default filename when no user questions found', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('assistant', 'Welcome! How can I help you today?', 'msg-1'),
      ];
      
      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      expect(mockJsPDF.save).toHaveBeenCalledWith('Hive Learning - Export.pdf');
    });

    test('should generate filename from first user question after system message', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('assistant', 'Welcome! How can I help you today?', 'msg-1'),
        createTestMessage('user', 'What is the difference between let and var in JavaScript?', 'msg-2'),
        createTestMessage('assistant', 'Great question!', 'msg-3'),
      ];
      
      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      expect(mockJsPDF.save).toHaveBeenCalledWith('Hive Learning - What is the difference between let and var in Java.pdf');
    });

    test('should sanitize filename properly', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('user', 'How do I use <script> tags & handle "quotes" in HTML?', 'msg-1'),
        createTestMessage('assistant', 'Good question!', 'msg-2'),
      ];
      
      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      expect(mockJsPDF.save).toHaveBeenCalledWith('Hive Learning - How do I use script tags handle quotes in HT.pdf');
    });

    test('should handle very short user questions', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('user', 'Help', 'msg-1'),
        createTestMessage('assistant', 'How can I assist you?', 'msg-2'),
      ];
      
      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      expect(mockJsPDF.save).toHaveBeenCalledWith('Hive Learning - Help.pdf');
    });

    test('should process markdown content correctly', async () => {
      await generateConversationPDF({
        messages: markdownMessages,
        timestamp: new Date(),
      });

      // Verify role labels are added
      expect(mockJsPDF.text).toHaveBeenCalledWith('You:', 20, expect.any(Number));
      expect(mockJsPDF.text).toHaveBeenCalledWith('Learning Assistant:', 20, expect.any(Number));

      // Verify splitTextToSize is called for message content
      expect(mockJsPDF.splitTextToSize).toHaveBeenCalled();
    });

    test('should handle messages with error flag', async () => {
      const messagesWithError: LearnMessage[] = [
        createTestMessage('user', 'Test question', 'msg-1'),
        createTestMessage('assistant', 'Error occurred', 'msg-2', true),
      ];
      
      await generateConversationPDF({
        messages: messagesWithError,
        timestamp: new Date(),
      });

      // Should still process the messages normally
      expect(mockJsPDF.text).toHaveBeenCalledWith('You:', 20, expect.any(Number));
      expect(mockJsPDF.text).toHaveBeenCalledWith('Learning Assistant:', 20, expect.any(Number));
    });

    test('should handle long conversations that require pagination', async () => {
      // Create a long conversation that would exceed page height
      const longMessages: LearnMessage[] = [];
      for (let i = 0; i < 20; i++) {
        longMessages.push(
          createTestMessage('user', `Question number ${i + 1}`, `user-${i}`),
          createTestMessage('assistant', `Answer number ${i + 1}. This is a longer response that contains multiple sentences to simulate realistic conversation content.`, `assistant-${i}`)
        );
      }

      await generateConversationPDF({
        messages: longMessages,
        timestamp: new Date(),
      });

      // Should call addPage when content exceeds page height
      expect(mockJsPDF.addPage).toHaveBeenCalled();
    });

    test('should format timestamp correctly for different locales', async () => {
      const timestamp = new Date('2024-12-25T23:45:30Z');
      
      await generateConversationPDF({
        messages: [createTestMessage('user', 'Test message', 'msg-1')],
        timestamp,
      });

      expect(mockJsPDF.text).toHaveBeenCalledWith('Exported: December 25, 2024 at 11:45 PM', 20, 35);
    });
  });

  describe('markdown processing (via addConversationAsText)', () => {
    test('should convert bullet points correctly', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('assistant', '- First bullet\n* Second bullet\n- Third bullet', 'msg-1'),
      ];

      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      // The splitTextToSize should be called with processed content (bullets converted to •)
      expect(mockJsPDF.splitTextToSize).toHaveBeenCalledWith(
        expect.stringContaining('• First bullet'),
        170 // contentWidth = pageWidth - (margin * 2) = 210 - 40
      );
    });

    test('should handle code blocks', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('assistant', 'Here is code:\n```javascript\nconst x = 1;\n```\nEnd of code.', 'msg-1'),
      ];

      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      // Code block markers should be removed but content preserved
      expect(mockJsPDF.splitTextToSize).toHaveBeenCalledWith(
        expect.stringContaining('const x = 1;'),
        170
      );
      expect(mockJsPDF.splitTextToSize).not.toHaveBeenCalledWith(
        expect.stringContaining('```'),
        expect.any(Number)
      );
    });

    test('should handle inline code', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('assistant', 'Use `console.log()` for debugging.', 'msg-1'),
      ];

      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      // Inline code backticks should be removed
      expect(mockJsPDF.splitTextToSize).toHaveBeenCalledWith(
        'Use console.log() for debugging.',
        170
      );
    });

    test('should handle bold text', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('assistant', 'This is **bold text** and regular text.', 'msg-1'),
      ];

      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      // Bold markers should be removed
      expect(mockJsPDF.splitTextToSize).toHaveBeenCalledWith(
        'This is bold text and regular text.',
        170
      );
    });

    test('should handle headers', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('assistant', '# Main Title\n## Subtitle\n### Sub-subtitle\nRegular text.', 'msg-1'),
      ];

      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      // Header markers should be removed but content preserved
      expect(mockJsPDF.splitTextToSize).toHaveBeenCalledWith(
        expect.stringContaining('Main Title'),
        170
      );
      expect(mockJsPDF.splitTextToSize).toHaveBeenCalledWith(
        expect.stringContaining('Subtitle'),
        170
      );
    });

    test('should handle complex markdown combinations', async () => {
      const messages: LearnMessage[] = [
        createTestMessage('assistant', 
          '## Overview\n\n' +
          'Here are the **key points**:\n\n' +
          '- Use `useState` for state\n' +
          '* Use `useEffect` for side effects\n\n' +
          'Example:\n' +
          '```javascript\n' +
          'const [count, setCount] = useState(0);\n' +
          '```',
          'msg-1'
        ),
      ];

      await generateConversationPDF({
        messages,
        timestamp: new Date(),
      });

      // Should process all markdown elements
      const processedContent = mockJsPDF.splitTextToSize.mock.calls.find(call => 
        typeof call[0] === 'string' && 
        call[0].includes('Overview') && 
        call[0].includes('key points')
      )?.[0];

      expect(processedContent).toContain('Overview');
      expect(processedContent).toContain('key points');
      expect(processedContent).toContain('• Use useState');
      expect(processedContent).toContain('• Use useEffect');
      expect(processedContent).toContain('const [count, setCount] = useState(0);');
      expect(processedContent).not.toContain('**');
      expect(processedContent).not.toContain('```');
      expect(processedContent).not.toContain('##');
    });
  });
});