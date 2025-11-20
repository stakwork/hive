declare module 'refractor/core.js' {
  export interface RefractorNode {
    type: string;
    value?: string;
    children?: RefractorNode[];
    tagName?: string;
    properties?: { [key: string]: any };
  }

  export interface Refractor {
    highlight(value: string, language: string): RefractorNode[];
    register(syntax: any): void;
    listLanguages(): string[];
  }

  const refractor: Refractor;
  export default refractor;
}

declare module 'refractor/lang/*.js' {
  const syntax: any;
  export default syntax;
}
