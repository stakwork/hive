"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Bug, GitBranch, AlertTriangle, FileText, GitPullRequest, Clock } from "lucide-react";

interface DebtMetric {
  label: string;
  value: string | number;
  icon: React.ElementType;
}

export function TechnicalDebtCard() {
  const metrics: DebtMetric[] = [
    {
      label: "Bug Fix Ratio",
      value: "27%",
      icon: Bug,
    },
    {
      label: "Code Complexity",
      value: "41%",
      icon: GitBranch,
    },
    {
      label: "File Churn",
      value: "13%",
      icon: FileText,
    },
    {
      label: "TODO/FIXME Comments",
      value: "18",
      icon: AlertTriangle,
    },
    {
      label: "PR Reverts",
      value: "7",
      icon: GitPullRequest,
    },
    {
      label: "Emergency Fixes",
      value: "5%",
      icon: Clock,
    }
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <BarChart3 className="h-5 w-5 text-indigo-500" />
          <span>Technical Debt Analyzer</span>
          <Badge variant="outline" className="text-xs text-gray-500">
            Coming Soon
          </Badge>
        </CardTitle>
        <CardDescription>
          Comprehensive analysis of code quality and maintenance burden
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-lg border bg-gray-50/50">
            <div>
              <p className="text-sm text-gray-400 mb-1">Debt Score</p>
              <div className="flex items-baseline space-x-3">
                <span className="text-3xl font-bold text-gray-400">
                  57
                </span>
                <span className="text-sm text-gray-400">/100</span>
              </div>
            </div>
            
            <div className="text-right">
              <p className="text-sm text-gray-400 mb-1">Level</p>
              <Badge 
                variant="outline" 
                className="text-gray-400 border-gray-300 bg-gray-50/50 font-semibold"
              >
                HIGH
              </Badge>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-400 flex items-center space-x-1">
              <AlertTriangle className="h-3 w-3" />
              <span>Key Metrics</span>
            </h4>
            
            <div className="grid grid-cols-3 gap-3">
              {metrics.map((metric) => {
                const Icon = metric.icon;
                return (
                  <div 
                    key={metric.label}
                    className="p-3 rounded-lg border border-gray-200 bg-gray-50/30"
                  >
                    <div className="flex items-center space-x-2 mb-2">
                      <Icon className="h-4 w-4 text-gray-400" />
                      <span className="text-xs text-gray-400">{metric.label}</span>
                    </div>
                    <p className="text-lg font-semibold text-gray-400">{metric.value}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-center py-4">
            <p className="text-xs text-gray-400">
              This feature will provide actionable insights to reduce technical debt and improve code maintainability.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}