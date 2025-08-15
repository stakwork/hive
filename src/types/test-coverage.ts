export interface TestCoverageMetric {
  total: number;
  covered: number;
  percent: number;
}

export interface TestCoverageData {
  functions: TestCoverageMetric;
  endpoints: TestCoverageMetric;
}

export interface TestCoverageResponse {
  success: boolean;
  data?: TestCoverageData;
  message?: string;
  details?: unknown;
}