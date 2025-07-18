import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Home, ArrowLeft, Heart } from "lucide-react";

export default function NotFound() {
    return (
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
            <div className="max-w-lg w-full text-center space-y-8">
                {/* Main Error Display */}
                <div className="space-y-6">
                    <h1 className="text-8xl md:text-9xl font-bold text-muted-foreground/30">
                        404
                    </h1>

                    <div className="space-y-3">
                        <h2 className="text-2xl md:text-3xl font-bold">
                            Still waiting on design
                        </h2>
                        <p className="text-muted-foreground">
                            Every great feature starts with a 404.
                        </p>
                    </div>
                </div>

                {/* PM Humor Card */}
                <Card className="bg-muted/20">
                    <CardContent className="p-6">
                        <p className="text-sm italic text-muted-foreground">
                            &quot;It’s MVP for now—we’ll iterate later.&quot;
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-2">
                            — Never iterated again
                        </p>
                    </CardContent>
                </Card>

                {/* Simple Actions */}
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Button asChild size="lg">
                        <Link href="/" className="flex items-center gap-2">
                            <Home className="w-4 h-4" />
                            Go Home
                        </Link>
                    </Button>

                    <Button asChild variant="outline" size="lg">
                        <Link
                            href="/workspaces"
                            className="flex items-center gap-2"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Workspaces
                        </Link>
                    </Button>
                </div>

                {/* Footer */}
                <p className="text-xs text-muted-foreground/60">
                    In loving memory of the feature this page was meant to be.{" "}
                    <Heart className="w-3 h-3 inline" />
                </p>
            </div>
        </div>
    );
}
