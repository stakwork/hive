declare module 'diff' {
  export interface Change {
    value: string;
    added?: boolean;
    removed?: boolean;
    count?: number;
  }

  export function diffLines(oldStr: string, newStr: string, options?: object): Change[];
  export function diffChars(oldStr: string, newStr: string, options?: object): Change[];
  export function diffWords(oldStr: string, newStr: string, options?: object): Change[];
}
