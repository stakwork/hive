"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRepositoryPermissions, getPermissionLevel } from "@/hooks/useRepositoryPermissions";
import { AlertTriangle, CheckCircle, Lock, RefreshCw, Shield, User } from "lucide-react";
import { useEffect } from "react";

interface RepositoryPermissionsProps {
  repositoryUrl: string;
  workspaceSlug?: string;
  autoCheck?: boolean;
}

export function RepositoryPermissions({ repositoryUrl, workspaceSlug, autoCheck = false }: RepositoryPermissionsProps) {
  const { permissions, loading, error, checkPermissions, reset } = useRepositoryPermissions();

  useEffect(() => {
    if (autoCheck && repositoryUrl) {
      checkPermissions(repositoryUrl, workspaceSlug);
    }
  }, [repositoryUrl, workspaceSlug, autoCheck, checkPermissions]);

  const handleCheck = () => {
    checkPermissions(repositoryUrl, workspaceSlug);
  };

  const permissionLevel = getPermissionLevel(permissions);

  const getStatusIcon = () => {
    if (loading) return <RefreshCw className="w-4 h-4 animate-spin" />;
    if (error) return <AlertTriangle className="w-4 h-4 text-red-500" />;
    if (!permissions?.hasAccess) return <Lock className="w-4 h-4 text-red-500" />;
    if (permissions.canAdmin) return <Shield className="w-4 h-4 text-green-600" />;
    if (permissions.canPush) return <CheckCircle className="w-4 h-4 text-green-500" />;
    return <User className="w-4 h-4 text-yellow-500" />;
  };

  const getStatusBadge = () => {
    if (loading) return <Badge variant="secondary">Checking...</Badge>;
    if (error) return <Badge variant="destructive">Error</Badge>;
    if (!permissions?.hasAccess) return <Badge variant="destructive">No Access</Badge>;
    if (permissions.canAdmin) return <Badge variant="default">Admin</Badge>;
    if (permissions.canPush) return <Badge variant="default">Write</Badge>;
    return <Badge variant="secondary">Read Only</Badge>;
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            {getStatusIcon()}
            Repository Permissions
          </CardTitle>
          {getStatusBadge()}
        </div>
        <CardDescription>GitHub App access permissions for this repository</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!permissions && !loading && !error && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-4">Click to check repository permissions</p>
            <Button onClick={handleCheck} variant="outline">
              <Shield className="w-4 h-4 mr-2" />
              Check Permissions
            </Button>
          </div>
        )}

        {loading && (
          <div className="text-center py-4">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
            <p className="text-sm text-muted-foreground">Checking repository permissions...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-4">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-red-500" />
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <Button onClick={handleCheck} variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </div>
        )}

        {permissions && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="font-medium text-sm">{permissionLevel.description}</p>
                <p className="text-xs text-muted-foreground">{permissions.repository?.full_name}</p>
              </div>
              <div className="text-right">
                {permissions.repository?.private && (
                  <Badge variant="outline" className="mb-1">
                    <Lock className="w-3 h-3 mr-1" />
                    Private
                  </Badge>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div
                className={`p-2 rounded text-center border ${
                  permissionLevel.canPerformAction("read")
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-gray-50 text-gray-500 border-gray-200"
                }`}
              >
                <div className="font-medium">Read</div>
                <div>{permissionLevel.canPerformAction("read") ? "✓" : "✗"}</div>
              </div>
              <div
                className={`p-2 rounded text-center border ${
                  permissionLevel.canPerformAction("push")
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-gray-50 text-gray-500 border-gray-200"
                }`}
              >
                <div className="font-medium">Push</div>
                <div>{permissionLevel.canPerformAction("push") ? "✓" : "✗"}</div>
              </div>
              <div
                className={`p-2 rounded text-center border ${
                  permissionLevel.canPerformAction("admin")
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-gray-50 text-gray-500 border-gray-200"
                }`}
              >
                <div className="font-medium">Admin</div>
                <div>{permissionLevel.canPerformAction("admin") ? "✓" : "✗"}</div>
              </div>
            </div>

            {!permissions.canPush && permissions.hasAccess && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center gap-2 text-yellow-800">
                  <AlertTriangle className="w-4 h-4" />
                  <p className="text-sm font-medium">Limited Access</p>
                </div>
                <p className="text-xs text-yellow-700 mt-1">
                  Your GitHub App has read-only access. Push permissions may be required for full functionality like
                  creating pull requests or commits.
                </p>
              </div>
            )}

            <div className="flex justify-between items-center">
              <Button onClick={handleCheck} variant="outline" size="sm">
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={reset} variant="ghost" size="sm">
                Clear
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
