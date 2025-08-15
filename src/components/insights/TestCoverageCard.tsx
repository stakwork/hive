"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TestTube, FunctionSquare, Globe, Loader2 } from "lucide-react";
import { TestCoverageData } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";

export function TestCoverageCard() {
  const { id: workspaceId } = useWorkspace();
  const [data, setData] = useState<TestCoverageData | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const fetchTestCoverage = useCallback(async () => {
    if (!workspaceId) {
      setError("No workspace selected");
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(undefined);

      const response = await fetch(`/api/tests/coverage?workspaceId=${workspaceId}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Failed to fetch test coverage");
      }

      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.message || "No coverage data available");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch test coverage");
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchTestCoverage();
  }, [workspaceId, fetchTestCoverage]);
  const getPercentageColor = (percent: number) => {
    if (percent >= 80) return "text-green-600 border-green-200 bg-green-50";
    if (percent >= 60) return "text-yellow-600 border-yellow-200 bg-yellow-50";
    return "text-red-600 border-red-200 bg-red-50";
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 80) return "bg-green-500";
    if (percent >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TestTube className="h-5 w-5 text-blue-500" />
            <span>Test Coverage</span>
          </CardTitle>
          <CardDescription>
            Code coverage analysis from your test suite
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TestTube className="h-5 w-5 text-blue-500" />
            <span>Test Coverage</span>
          </CardTitle>
          <CardDescription>
            Code coverage analysis from your test suite
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              {error}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TestTube className="h-5 w-5 text-blue-500" />
            <span>Test Coverage</span>
          </CardTitle>
          <CardDescription>
            Code coverage analysis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              No coverage data available.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <TestTube className="h-5 w-5 text-blue-500" />
          <span>Test Coverage</span>
        </CardTitle>
        <CardDescription>
          Code coverage analysis from your test suite
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Unit Tests Coverage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FunctionSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Unit Tests</span>
              </div>
              <Badge variant="outline" className={getPercentageColor(data.functions.percent)}>
                {data.functions.percent.toFixed(1)}%
              </Badge>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(data.functions.percent)}`}
                style={{ width: `${Math.min(data.functions.percent, 100)}%` }}
              />
            </div>
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{data.functions.covered} covered</span>
              <span>{data.functions.total} total</span>
            </div>
          </div>

          {/* Integration Tests Coverage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Integration Tests</span>
              </div>
              <Badge variant="outline" className={getPercentageColor(data.endpoints.percent)}>
                {data.endpoints.percent.toFixed(1)}%
              </Badge>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(data.endpoints.percent)}`}
                style={{ width: `${Math.min(data.endpoints.percent, 100)}%` }}
              />
            </div>
            
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{data.endpoints.covered} covered</span>
              <span>{data.endpoints.total} total</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}