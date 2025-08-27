"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Server } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import Link from "next/link";

export function VMConfigSection() {
  const { slug } = useWorkspace();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="w-5 h-5" />
          VM Configuration
        </CardTitle>
        <CardDescription>
          Configure your virtual machine settings for development environment
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-end">
          <Button asChild>
            <Link href={slug ? `/w/${slug}/stakgraph` : "#"}>
              <Settings className="w-4 h-4 mr-2" />
              Configure VM
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}