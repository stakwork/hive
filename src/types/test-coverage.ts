export interface TestCoverageMetric {
  total: number;
  covered: number;
  percent: number;
}

export interface E2ETestMetric {
  total: number;
}

export interface TestCoverageData {
  functions: TestCoverageMetric;
  endpoints: TestCoverageMetric;
  e2e_tests?: E2ETestMetric;
}

export interface TestCoverageResponse {
  success: boolean;
  data?: TestCoverageData;
  message?: string;
  details?: unknown;
}