import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";

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
              Page not found
            </h2>
            <p className="text-muted-foreground">
              The page you are looking for does not exist or has been moved.
            </p>
          </div>
        </div>

        {/* Simple Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg">
            <Link href="/" className="flex items-center gap-2">
              <Home className="w-4 h-4" />
              Go Home
            </Link>
          </Button>

          <Button asChild variant="outline" size="lg">
            <Link href="/workspaces" className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Workspaces
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
