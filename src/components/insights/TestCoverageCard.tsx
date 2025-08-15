"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TestTube, Target, Loader2 } from "lucide-react";
import { TestCoverageData } from "@/types";

interface TestCoverageCardProps {
  data?: TestCoverageData;
  isLoading?: boolean;
  error?: string;
}

export function TestCoverageCard({ data, isLoading, error }: TestCoverageCardProps) {
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
          {/* Functions Coverage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <TestTube className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Functions</span>
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

          {/* Endpoints Coverage */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Endpoints</span>
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