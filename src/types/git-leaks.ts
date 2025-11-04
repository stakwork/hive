export interface GitLeakResult {
  Author: string;
  Commit: string;
  Date: string;
  Description: string;
  Email: string;
  EndColumn: number;
  EndLine: number;
  Entropy: number;
  File: string;
  Fingerprint: string;
  Link: string;
  Match: string;
  Message: string;
  RuleID: string;
  Secret: string;
  StartColumn: number;
  StartLine: number;
  SymlinkFile: string;
  Tags: string[];
}
