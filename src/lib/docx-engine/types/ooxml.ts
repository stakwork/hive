/**
 * Raw fast-xml-parser node shape for OOXML documents.
 * fast-xml-parser with attributeNamePrefix:"@_" and ignoreAttributes:false.
 */

export type OoxmlAttrValue = string | number | boolean;

export interface OoxmlAttributes {
  [key: string]: OoxmlAttrValue;
}

/**
 * A parsed XML node as returned by fast-xml-parser.
 * Children are stored as named properties; text content as "#text".
 * Attributes are prefixed with "@_".
 */
export interface OoxmlNode {
  [key: string]: OoxmlNode | OoxmlNode[] | OoxmlAttrValue | undefined;
}

/**
 * Root document structure returned by fast-xml-parser for word/document.xml
 */
export interface OoxmlDocumentRoot {
  "w:document"?: OoxmlNode;
  [key: string]: OoxmlNode | undefined;
}

/**
 * Root structure for word/styles.xml
 */
export interface OoxmlStylesRoot {
  "w:styles"?: OoxmlNode;
  [key: string]: OoxmlNode | undefined;
}

/**
 * Root structure for word/numbering.xml
 */
export interface OoxmlNumberingRoot {
  "w:numbering"?: OoxmlNode;
  [key: string]: OoxmlNode | undefined;
}

/**
 * Root structure for word/comments.xml
 */
export interface OoxmlCommentsRoot {
  "w:comments"?: OoxmlNode;
  [key: string]: OoxmlNode | undefined;
}
