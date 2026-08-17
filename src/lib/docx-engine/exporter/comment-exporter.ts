/**
 * Exports DocxComment[] to a word/comments.xml string.
 *
 * author and body pass through xmlAttrEscape() / xmlTextEscape().
 */

import { DocxComment } from "../types/document";
import { xmlAttrEscape, xmlTextEscape } from "../core/xml-escape";

/**
 * Serialize a DocxComment[] to a complete word/comments.xml XML string.
 */
export function serializeComments(comments: DocxComment[]): string {
  if (comments.length === 0) {
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:comments xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ` +
      `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
      `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ` +
      `xmlns:v="urn:schemas-microsoft-com:vml" ` +
      `xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ` +
      `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
      `xmlns:w10="urn:schemas-microsoft-com:office:word" ` +
      `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
      `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ` +
      `xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" ` +
      `xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" ` +
      `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ` +
      `mc:Ignorable="w14 wp14"></w:comments>`
    );
  }

  const commentXmls = comments.map((c) => {
    const id = xmlAttrEscape(c.id);
    const author = xmlAttrEscape(c.author);
    const date = xmlAttrEscape(c.date);
    const bodyText = xmlTextEscape(c.body);

    return (
      `<w:comment w:id="${id}" w:author="${author}" w:date="${date}">` +
      `<w:p>` +
      `<w:r>` +
      `<w:t xml:space="preserve">${bodyText}</w:t>` +
      `</w:r>` +
      `</w:p>` +
      `</w:comment>`
    );
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:comments xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ` +
    `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
    `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ` +
    `xmlns:v="urn:schemas-microsoft-com:vml" ` +
    `xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:w10="urn:schemas-microsoft-com:office:word" ` +
    `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ` +
    `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" ` +
    `xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" ` +
    `xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" ` +
    `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ` +
    `mc:Ignorable="w14 wp14">` +
    commentXmls.join("") +
    `</w:comments>`
  );
}
