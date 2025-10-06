import jsPDF from 'jspdf';
import type { LearnMessage } from '@/types/learn';

interface GenerateConversationPDFOptions {
  messages: LearnMessage[];
  timestamp: Date;
}

export async function generateConversationPDF(options: GenerateConversationPDFOptions): Promise<void> {
  const { messages, timestamp } = options;
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);

  let yPosition = margin;

  // Add title
  pdf.setFontSize(20);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Learning Assistant Conversation', margin, yPosition);
  yPosition += 15;

  // Add timestamp
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(100, 100, 100);
  const formattedDate = timestamp.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  pdf.text(`Exported: ${formattedDate}`, margin, yPosition);
  yPosition += 10;

  // Add separator line
  pdf.setLineWidth(0.5);
  pdf.setDrawColor(200, 200, 200);
  pdf.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;

  // Use text-based rendering
  addConversationAsText(pdf, messages, margin, yPosition, contentWidth, pageHeight);

  // Generate filename based on the conversation
  const firstQuestion = messages.find(m => m.role === 'user' && messages.indexOf(m) > 0);
  let filename: string;

  if (firstQuestion) {
    const sanitizedQuestion = firstQuestion.content
      .substring(0, 50) // Shorter limit for cleaner filenames
      .replace(/[^a-z0-9\s]/gi, '')
      .trim()
      .replace(/\s+/g, ' '); // Keep spaces for readability
    filename = `Hive Learning - ${sanitizedQuestion || 'Export'}.pdf`;
  } else {
    filename = 'Hive Learning - Export.pdf';
  }

  // Save the PDF
  pdf.save(filename);
}

function addConversationAsText(
  pdf: jsPDF,
  messages: LearnMessage[],
  x: number,
  y: number,
  maxWidth: number,
  pageHeight: number
): void {
  const margin = 20;
  let currentY = y;

  messages.forEach((message) => {
    // Check if we need a new page
    if (currentY + 20 > pageHeight - margin) {
      pdf.addPage();
      currentY = margin;
    }

    // Add role label
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(0, 0, 0);
    const roleLabel = message.role === 'user' ? 'You:' : 'Learning Assistant:';
    pdf.text(roleLabel, x, currentY);
    currentY += 7;

    // Add message content
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);

    // Basic markdown handling
    let content = message.content;

    // Handle bullet points
    content = content.replace(/^[\*\-]\s+/gm, '• ');

    // Handle code blocks
    content = content.replace(/```[\s\S]*?```/g, (match) => {
      return match.replace(/```/g, '').trim();
    });

    // Handle inline code
    content = content.replace(/`([^`]+)`/g, '$1');

    // Handle bold
    content = content.replace(/\*\*([^\*]+)\*\*/g, '$1');

    // Remove headers markup
    content = content.replace(/^#{1,6}\s+(.+)$/gm, '$1');

    const lines = pdf.splitTextToSize(content, maxWidth);

    lines.forEach((line: string) => {
      if (currentY + 5 > pageHeight - margin) {
        pdf.addPage();
        currentY = margin;
      }
      pdf.text(line, x, currentY);
      currentY += 5;
    });

    currentY += 8; // Add space between messages
  });
}

