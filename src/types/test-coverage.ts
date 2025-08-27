export interface TestCoverageMetric {
  total: number;
  covered: number;
  percent: number;
}

export interface TestCoverageData {
  unit_tests: TestCoverageMetric;
  integration_tests: TestCoverageMetric;
  e2e_tests: TestCoverageMetric;
}

export interface TestCoverageResponse {
  success: boolean;
  data?: TestCoverageData;
  message?: string;
  details?: unknown;
}