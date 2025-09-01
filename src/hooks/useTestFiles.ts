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
  const [testFiles, setTestFiles] = useState<TestFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>(
    {},
  );
  const [expandedTests, setExpandedTests] = useState<Record<string, boolean>>(
    {},
  );
  const [loadingTests, setLoadingTests] = useState<Record<string, boolean>>({});

  const fetchTestFiles = useCallback(async () => {
    if (!baseUrl) return;
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

  const normalizeTestFile = (file: TestFile): TestFile => {
    return {
      name: file.name || "unknown.spec.js",
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
      if (!baseUrl) return { success: false, error: "Base URL not set" };
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers["x-api-token"] = apiKey;
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

  const runAllTests = async () => {
    try {
      if (!baseUrl) return { success: false, error: "Base URL not set" };
      const headers: Record<string, string> = {};
      if (apiKey) headers["x-api-token"] = apiKey;
      const res = await fetch(`${baseUrl}/test?test=all`, { headers });
      const data = await res.json();
      return {
        success: !!data.success,
        output: data.output || "",
        errors: data.errors || data.error || "",
      } as TestResult & { errors?: string };
    } catch (error) {
      console.error("Error running all tests:", error);
      return { success: false, error } as unknown as TestResult;
    }
  };

  const deleteTest = async (testName: string) => {
    try {
      if (!baseUrl) return false;
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
      if (!baseUrl) return { success: false, error: "Base URL not set" };
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

  const renameTest = async (fromName: string, toName: string) => {
    if (!fromName || !toName || fromName === toName) {
      return { success: false, error: "Invalid names" };
    }

    try {
      if (!baseUrl) return { success: false, error: "Base URL not set" };
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["x-api-token"] = apiKey;
      }

      const response = await fetch(`${baseUrl}/test/rename`, {
        method: "POST",
        headers,
        body: JSON.stringify({ from: fromName, to: toName }),
      });

      const result = await response.json();
      if (result.success) {
        await fetchTestFiles();
      }

      return result;
    } catch (error) {
      console.error("Error renaming test:", error);
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
    if (baseUrl) fetchTestFiles();
  }, [fetchTestFiles, baseUrl]);

  return {
    testFiles,
    isLoading,
    testResults,
    expandedTests,
    loadingTests,
    fetchTestFiles,
    runTest,
    runAllTests,
    deleteTest,
    saveTest,
    renameTest,
    toggleTestExpansion,
  };
}
