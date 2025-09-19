import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import type { LearnMessage } from '@/types/learn';

interface GeneratePDFOptions {
  question?: string;
  answer: string;
  timestamp: Date;
  elementId?: string;
  messageElement?: HTMLElement;
}

interface GenerateConversationPDFOptions {
  messages: LearnMessage[];
  timestamp: Date;
  conversationElement?: HTMLElement;
}

export async function generateLearningPDF(options: GeneratePDFOptions): Promise<void> {
  const { question, answer, timestamp, elementId, messageElement } = options;

  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);

  let yPosition = margin;

  // Add title
  pdf.setFontSize(20);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Learning Assistant Response', margin, yPosition);
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
  pdf.text(`Generated: ${formattedDate}`, margin, yPosition);
  yPosition += 10;

  // Add separator line
  pdf.setLineWidth(0.5);
  pdf.setDrawColor(200, 200, 200);
  pdf.line(margin, yPosition, pageWidth - margin, yPosition);
  yPosition += 10;

  // Add question if provided
  if (question) {
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Question:', margin, yPosition);
    yPosition += 7;

    pdf.setFont('helvetica', 'normal');
    const questionLines = pdf.splitTextToSize(question, contentWidth);
    pdf.text(questionLines, margin, yPosition);
    yPosition += questionLines.length * 5 + 10;

    // Add separator
    pdf.setLineWidth(0.3);
    pdf.setDrawColor(220, 220, 220);
    pdf.line(margin, yPosition - 5, pageWidth - margin, yPosition - 5);
    yPosition += 5;
  }

  // Add answer
  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text('Answer:', margin, yPosition);
  yPosition += 7;

  // Try to capture the rendered message element first
  const elementToCapture = messageElement || (elementId ? document.getElementById(elementId) : null);

  if (elementToCapture) {
    try {
      // Create a temporary wrapper to ensure proper styling
      const tempWrapper = document.createElement('div');
      tempWrapper.style.position = 'fixed';
      tempWrapper.style.left = '-9999px';
      tempWrapper.style.top = '0';
      tempWrapper.style.width = '800px';
      tempWrapper.style.backgroundColor = 'white';
      tempWrapper.style.padding = '20px';

      // Clone the element to avoid modifying the original
      const clonedElement = elementToCapture.cloneNode(true) as HTMLElement;

      // Ensure proper styling for the cloned element
      clonedElement.style.maxWidth = '100%';
      clonedElement.style.margin = '0';

      tempWrapper.appendChild(clonedElement);
      document.body.appendChild(tempWrapper);

      const canvas = await html2canvas(clonedElement, {
        scale: 2, // Higher quality
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 800,
        onclone: (clonedDoc: Document) => {
          // Ensure styles are properly applied in the clone
          const clonedEl = clonedDoc.querySelector('[class*="prose"]');
          if (clonedEl) {
            // Force text colors for better readability in PDF
            const allElements = clonedEl.querySelectorAll('*');
            allElements.forEach((el: Element) => {
              if (el instanceof HTMLElement) {
                el.style.color = '#000000';
              }
            });
          }
        }
      } as any);

      // Clean up
      document.body.removeChild(tempWrapper);

      // Calculate dimensions to fit on page
      const imgWidth = contentWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // Check if we need a new page
      if (yPosition + imgHeight > pageHeight - margin) {
        pdf.addPage();
        yPosition = margin;
      }

      // Add the image
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', margin, yPosition, imgWidth, imgHeight);

    } catch (error) {
      console.error('Error capturing element:', error);
      // Fall back to text-based rendering
      addTextContent(pdf, answer, margin, yPosition, contentWidth);
    }
  } else {
    // No element to capture, use text-based rendering
    addTextContent(pdf, answer, margin, yPosition, contentWidth);
  }

  // Generate filename based on question
  let filename: string;
  if (question) {
    // Sanitize the question for use as a filename
    const sanitizedQuestion = question
      .substring(0, 80) // Limit to 80 chars for reasonable filename length
      .replace(/[^a-z0-9\s]/gi, '') // Remove special characters
      .trim()
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .toLowerCase();

    filename = `${sanitizedQuestion || 'learning_answer'}.pdf`;
  } else {
    filename = 'learning_answer.pdf';
  }

  // Save the PDF
  pdf.save(filename);
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

function addTextContent(
  pdf: jsPDF,
  content: string,
  x: number,
  y: number,
  maxWidth: number
): void {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(0, 0, 0);

  // Clean up the content (remove markdown formatting for now)
  const cleanContent = content
    .replace(/#{1,6}\s/g, '') // Remove headers
    .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.*?)\*/g, '$1') // Remove italic
    .replace(/`{3}[\s\S]*?`{3}/g, (match) => {
      // Preserve code blocks but remove backticks
      return match.replace(/`{3}/g, '').trim();
    })
    .replace(/`(.*?)`/g, '$1') // Remove inline code backticks
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // Remove links, keep text

  const lines = pdf.splitTextToSize(cleanContent, maxWidth);

  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 20;
  const lineHeight = 5;
  let currentY = y;

  for (const line of lines) {
    // Check if we need a new page
    if (currentY + lineHeight > pageHeight - margin) {
      pdf.addPage();
      currentY = margin;
    }

    pdf.text(line, x, currentY);
    currentY += lineHeight;
  }
}