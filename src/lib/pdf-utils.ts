import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface GeneratePDFOptions {
  question?: string;
  answer: string;
  timestamp: Date;
  elementId?: string;
}

export async function generateLearningPDF(options: GeneratePDFOptions): Promise<void> {
  const { question, answer, timestamp, elementId } = options;

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

  // If elementId is provided, try to capture the rendered HTML
  if (elementId) {
    const element = document.getElementById(elementId);
    if (element) {
      try {
        // Temporarily make the element visible if needed
        const originalDisplay = element.style.display;
        element.style.display = 'block';

        const canvas = await html2canvas(element, {
          useCORS: true,
          logging: false,
        });

        // Restore original display
        element.style.display = originalDisplay;

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
      // Element not found, use text-based rendering
      addTextContent(pdf, answer, margin, yPosition, contentWidth);
    }
  } else {
    // No element ID provided, use text-based rendering
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