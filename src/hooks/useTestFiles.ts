import { useEffect, useState, useCallback } from "react";

export interface TestResult {
  success: boolean;
  output?: string;
  errors?: string;
}

export interface TestFile {
  name: string;
  created: string;
  modified: string;
  size: number;
}

export function useTestFiles(baseUrl: string, apiKey?: string) {
  const [testFiles, setTestFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {},
  );
  const [expandedTests, setExpandedTests] = useState<Record<string, boolean>>(
    {},
  );
  const [loadingTests, setLoadingTests] = useState({});

  const fetchTestFiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["x-api-token"] = apiKey;
      }

      const response = await fetch(`${baseUrl}/test/list`, {
        headers,
      });
      const data = await response.json();
      if (data.success) {
        setTestFiles((data.tests || []).map(normalizeTestFile));
      } else {
        console.error("Unexpected response format:", data);
      }
    } catch (error) {
      console.error("Error fetching test files:", error);
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl, apiKey]);

  const normalizeTestFile = (file: TestFile) => {
    return {
      filename: file.name || "unknown.spec.js",
      created: file.created || new Date().toISOString(),
      modified: file.modified || new Date().toISOString(),
      size: file.size || 0,
    };
  };

  const runTest = async (testName: string) => {
    setLoadingTests((prev) => ({
      ...prev,
      [testName]: true,
    }));

    try {
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["x-api-token"] = apiKey;
      }

      const getResponse = await fetch(
        `${baseUrl}/test/get?name=${encodeURIComponent(testName)}`,
        {
          headers,
        },
      );
      const testData = await getResponse.json();

      if (!testData || !testData.success) {
        throw new Error(testData.error || "Failed to retrieve test content");
      }

      const runResponse = await fetch(
        `${baseUrl}/test?test=${encodeURIComponent(testName)}`,
        {
          headers,
        },
      );
      const runResult = await runResponse.json();

      const testResult = {
        success: runResult.success,
        output: runResult.output || "",
        errors: runResult.errors || "",
      };

      setTestResults((prevResults) => ({
        ...prevResults,
        [testName]: testResult,
      }));

      setExpandedTests((prev) => ({
        ...prev,
        [testName]: true,
      }));

      return testResult;
    } catch (error) {
      console.error("Error running test:", error);
      return { success: false, error };
    } finally {
      setLoadingTests((prev) => ({
        ...prev,
        [testName]: false,
      }));
    }
  };

  const deleteTest = async (testName: string) => {
    if (!confirm(`Are you sure you want to delete ${testName}?`)) return false;

    try {
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["x-api-token"] = apiKey;
      }

      const response = await fetch(
        `${baseUrl}/test/delete?name=${encodeURIComponent(testName)}`,
        {
          headers,
        },
      );
      const data = await response.json();

      if (data.success) {
        setTestResults((prevResults) => {
          const newResults = { ...prevResults };
          delete newResults[testName];
          return newResults;
        });

        await fetchTestFiles();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error deleting test:", error);
      return false;
    }
  };

  const saveTest = async (filename: string, testCode: string) => {
    if (!testCode) return { success: false, error: "No test code to save" };

    if (!filename.trim()) {
      return { success: false, error: "Filename is required" };
    }

    try {
      let formattedFilename = filename;
      if (!formattedFilename.endsWith(".spec.js")) {
        formattedFilename = formattedFilename.endsWith(".js")
          ? formattedFilename.replace(".js", ".spec.js")
          : `${formattedFilename}.spec.js`;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["x-api-token"] = apiKey;
      }

      const response = await fetch(`${baseUrl}/test/save`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: formattedFilename,
          text: testCode,
        }),
      });

      const result = await response.json();

      if (result.success) {
        await fetchTestFiles();
      }

      return result;
    } catch (error) {
      console.error("Error saving test:", error);
      return { success: false, error };
    }
  };

  const toggleTestExpansion = (testName: string) => {
    setExpandedTests((prev) => ({
      ...prev,
      [testName]: !prev[testName],
    }));
  };

  useEffect(() => {
    fetchTestFiles();
  }, [fetchTestFiles]);

  return {
    testFiles,
    isLoading,
    testResults,
    expandedTests,
    loadingTests,
    fetchTestFiles,
    runTest,
    deleteTest,
    saveTest,
    toggleTestExpansion,
  };
}
