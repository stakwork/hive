export interface TestCoverageMetric {
  total: number;
  covered: number;
  percent: number;
  total_lines?: number;
  covered_lines?: number;
  line_percent?: number;
}

export interface TestCoverageData {
  unit_tests: TestCoverageMetric;
  integration_tests: TestCoverageMetric;
  e2e_tests: TestCoverageMetric;
}

export interface TestCoverageResponse {
  success: boolean;
  data?: TestCoverageData;
  ignoreDirs?: string;
  message?: string;
  details?: unknown;
}
