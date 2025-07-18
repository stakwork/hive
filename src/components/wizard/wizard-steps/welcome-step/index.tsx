import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Github,
    TrendingUp,
    BarChart3,
    GitBranch,
    ArrowRight,
} from "lucide-react";

interface WelcomeStepProps {
    onNext: () => void;
    stepStatus?: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";
    onStatusChange?: (
        status: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED"
    ) => void;
}

export function WelcomeStep({ onNext, onStatusChange }: WelcomeStepProps) {
    const handleNext = () => {
        onStatusChange?.("COMPLETED");
        onNext();
    };
    return (
        <Card className="max-w-4xl mx-auto bg-card text-card-foreground">
            <CardHeader className="text-center">
                <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Github className="w-8 h-8 text-blue-600 dark:text-blue-300" />
                </div>
                <CardTitle className="text-2xl">
                    Welcome to Code Graph
                </CardTitle>
                <CardDescription className="text-lg">
                    Let&apos;s start by selecting a repository to analyze
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="text-center">
                    <p className="text-muted-foreground mb-6">
                        We&apos;ll help you visualize dependencies,
                        relationships, and collaboration patterns in your
                        codebase.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto mb-8">
                        <div className="p-4 border rounded-lg bg-muted">
                            <div className="flex items-center gap-2 mb-2">
                                <GitBranch className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                                <span className="text-sm font-medium">
                                    Repository Mapping
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Visualize connections between your repositories
                            </p>
                        </div>

                        <div className="p-4 border rounded-lg bg-muted">
                            <div className="flex items-center gap-2 mb-2">
                                <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-300" />
                                <span className="text-sm font-medium">
                                    Dependency Analysis
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Track dependencies and their relationships
                            </p>
                        </div>

                        <div className="p-4 border rounded-lg bg-muted">
                            <div className="flex items-center gap-2 mb-2">
                                <BarChart3 className="w-4 h-4 text-purple-600 dark:text-purple-300" />
                                <span className="text-sm font-medium">
                                    Collaboration Insights
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Understand team collaboration patterns
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex justify-center">
                    <Button onClick={handleNext} className="px-8 py-3">
                        Get Started
                        <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
