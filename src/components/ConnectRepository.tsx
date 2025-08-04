"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Rocket, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

interface ConnectRepositoryProps {
  workspaceSlug: string;
  className?: string;
  title?: string;
  description?: string;
  buttonText?: string;
}

export function ConnectRepository({
  workspaceSlug,
  className = "",
  title = "Get Started with CodeGraph",
  description = "Connect your repository and set up your development environment in just a few minutes.",
  buttonText = "Connect Repository",
}: ConnectRepositoryProps) {
  const router = useRouter();

  const handleStartSetup = () => {
    router.push(`/w/${workspaceSlug}/code-graph`);
  };

  return (
    <Card
      className={`border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 ${className}`}
    >
      <CardHeader>
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
            <Rocket className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription className="text-base">
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              ✓ Deep code context analysis
              <br />
              ✓ Automated testing environment
              <br />✓ Visual workflow management
            </p>
          </div>
          <Button
            onClick={handleStartSetup}
            size="lg"
            className="flex items-center space-x-2"
          >
            <span>{buttonText}</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
