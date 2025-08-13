import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { authOptions } from "@/lib/auth/nextauth";
import { handleWorkspaceRedirect } from "@/lib/auth/workspace-resolver";
import {
  ArrowRight,
  Code,
  GitBranch,
  LogIn,
  Sparkles,
  TestTube,
  TrendingUp,
  Workflow,
} from "lucide-react";
import { getServerSession } from "next-auth/next";
import Link from "next/link";

export default async function HomePage() {
  // Check if user is authenticated and handle workspace redirection
  const session = await getServerSession(authOptions);

  if (session?.user) {
    // User is authenticated - redirect them to their appropriate workspace or onboarding
    await handleWorkspaceRedirect(session);
    // This redirect prevents the rest of the page from rendering
    return null;
  }

  // User is not authenticated - show landing page
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header Navigation */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-8">
              <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-purple-400">
                Hive
              </h1>
              <NavigationMenu>
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <NavigationMenuTrigger>Features</NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <div className="grid gap-3 p-4 w-[500px]">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-3 hover:bg-accent rounded-md">
                            <div className="flex items-center gap-2 mb-1">
                              <Code className="w-4 h-4" />
                              <h4 className="font-medium">Deep Code Context</h4>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Answer questions about your company and codebase
                              instantly
                            </p>
                          </div>
                          <div className="p-3 hover:bg-accent rounded-md">
                            <div className="flex items-center gap-2 mb-1">
                              <TestTube className="w-4 h-4" />
                              <h4 className="font-medium">
                                Test Code Coverage
                              </h4>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Boost coverage from unit tests to comprehensive
                              e2e testing
                            </p>
                          </div>
                          <div className="p-3 hover:bg-accent rounded-md">
                            <div className="flex items-center gap-2 mb-1">
                              <GitBranch className="w-4 h-4" />
                              <h4 className="font-medium">
                                Hosted Testing Environment
                              </h4>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Test branch changes easily as a PM without dev
                              setup
                            </p>
                          </div>
                          <div className="p-3 hover:bg-accent rounded-md">
                            <div className="flex items-center gap-2 mb-1">
                              <Workflow className="w-4 h-4" />
                              <h4 className="font-medium">Visual Workflows</h4>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              See inside the black box with visual workflows,
                              not system prompts
                            </p>
                          </div>
                        </div>
                      </div>
                    </NavigationMenuContent>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <Link href="/">Back to main</Link>
                  </NavigationMenuItem>
                </NavigationMenuList>
              </NavigationMenu>
            </div>

            <div className="flex items-center space-x-4">
              <Link href="/auth/signin">
                <Button
                  variant="outline"
                  className="flex items-center space-x-2"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Sign In</span>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <Badge
            variant="secondary"
            className="mx-auto mb-6 text-base px-4 py-2 flex items-center gap-2 w-fit"
          >
            <Sparkles className="w-4 h-4" />
            Empowering Modern PMs
          </Badge>

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6">
            &ldquo;Get Started&rdquo;
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto">
            Move faster. Break less. Hive gives you deep code clarity so you can
            ship with speed and confidence.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link href="/auth/signin">
              <Button size="lg" className="text-lg px-8 py-6">
                Start Building Today
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-4 bg-card/50 dark:bg-card/80">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Everything you need to ship with confidence
            </h2>
            <p className="text-xl text-muted-foreground">
              Deep code insights, visual workflows, and seamless testing—built
              for modern product managers
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow bg-card text-card-foreground">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto bg-blue-100 dark:bg-blue-900">
                  <Code className="w-8 h-8 text-blue-600 dark:text-blue-300" />
                </div>
                <h3 className="text-xl font-semibold mb-3">
                  Deep Code Context
                </h3>
                <p className="text-muted-foreground">
                  Get instant answers about your company and codebase without
                  bothering developers.
                </p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow bg-card text-card-foreground">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto bg-green-100 dark:bg-green-900">
                  <TestTube className="w-8 h-8 text-green-600 dark:text-green-300" />
                </div>
                <h3 className="text-xl font-semibold mb-3">
                  Comprehensive Testing
                </h3>
                <p className="text-muted-foreground">
                  Boost test coverage from basic unit tests to full end-to-end
                  testing suites.
                </p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow bg-card text-card-foreground">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto bg-purple-100 dark:bg-purple-900">
                  <GitBranch className="w-8 h-8 text-purple-600 dark:text-purple-300" />
                </div>
                <h3 className="text-xl font-semibold mb-3">
                  Hosted Testing Environment
                </h3>
                <p className="text-muted-foreground">
                  Test branch changes instantly as a PM—no complex dev setup
                  required.
                </p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow bg-card text-card-foreground">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto bg-orange-100 dark:bg-orange-900">
                  <Workflow className="w-8 h-8 text-orange-600 dark:text-orange-300" />
                </div>
                <h3 className="text-xl font-semibold mb-3">Visual Workflows</h3>
                <p className="text-muted-foreground">
                  See inside the black box with visual workflows, not confusing
                  system prompts.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* PM Highlights Section */}
      <section className="py-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              Trusted by product managers worldwide
            </h2>
            <p className="text-lg text-muted-foreground">
              Join thousands of PMs who ship faster with deep code insights
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-blue-600 dark:text-blue-300 mb-2">
                2,400+
              </div>
              <div className="text-muted-foreground">
                Code Contexts Analyzed
              </div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-green-600 dark:text-green-300 mb-2">
                12,000+
              </div>
              <div className="text-muted-foreground">Test Cases Generated</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-purple-600 dark:text-purple-300 mb-2">
                5,800+
              </div>
              <div className="text-muted-foreground">Branches Tested</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-orange-600 dark:text-orange-300 mb-2">
                4,200+
              </div>
              <div className="text-muted-foreground">PMs Empowered</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to ship with confidence?
          </h2>
          <p className="text-xl mb-8 opacity-90">
            Join product managers who move fast, scale safely, and lead with
            deep code insights.
          </p>
          <Link href="/auth/signin">
            <Button size="lg" variant="secondary" className="text-lg px-8 py-6">
              Get Started Free
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 bg-card border-t text-card-foreground">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-300" />
            <span className="text-lg font-semibold">Hive</span>
          </div>
          <p className="text-muted-foreground mb-4">
            Empowering product managers with deep code insights, visual
            workflows, and seamless testing.
          </p>
          <div className="flex justify-center space-x-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground">
              Privacy
            </a>
            <a href="#" className="hover:text-foreground">
              Terms
            </a>
            <a href="#" className="hover:text-foreground">
              Support
            </a>
            <a href="#" className="hover:text-foreground">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
