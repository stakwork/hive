"use client";

import { ArrowLeft, ChevronRight, Slash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function BreadcrumbTestPage() {
  const mockFeatureTitle = "User Authentication System";
  const mockTaskTitle = "Implement JWT token refresh mechanism";
  const mockWorkspaceSlug = "my-workspace";

  return (
    <div className="container mx-auto py-8 space-y-8 max-w-5xl">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Breadcrumb UI Variations</h1>
        <p className="text-muted-foreground">
          Compare different breadcrumb styles for the Task Chat page
        </p>
      </div>

      {/* Variation 1: Current Implementation (Horizontal with chevron) */}
      <Card>
        <CardHeader>
          <CardTitle>Variation 1: Horizontal with › Chevron (Current)</CardTitle>
          <CardDescription>Simple, minimal style matching phase page</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-4 bg-muted/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" className="flex-shrink-0">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  
                  {/* Breadcrumbs */}
                  <div className="text-sm text-muted-foreground">
                    <span
                      className="hover:underline cursor-pointer"
                      onClick={() => alert(`Navigate to: /w/${mockWorkspaceSlug}/plan/feature-123`)}
                    >
                      {mockFeatureTitle}
                    </span>
                    <span className="mx-2">›</span>
                    <span>Task</span>
                  </div>
                </div>

                <h2 className="text-lg font-semibold text-foreground truncate">
                  {mockTaskTitle}
                </h2>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Variation 2: With ChevronRight Icon */}
      <Card>
        <CardHeader>
          <CardTitle>Variation 2: ChevronRight Icon Separator</CardTitle>
          <CardDescription>Using Lucide icon for more consistent sizing</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-4 bg-muted/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" className="flex-shrink-0">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  
                  <div className="flex items-center text-sm text-muted-foreground">
                    <span
                      className="hover:underline cursor-pointer"
                      onClick={() => alert(`Navigate to: /w/${mockWorkspaceSlug}/plan/feature-123`)}
                    >
                      {mockFeatureTitle}
                    </span>
                    <ChevronRight className="w-4 h-4 mx-1" />
                    <span>Task</span>
                  </div>
                </div>

                <h2 className="text-lg font-semibold text-foreground truncate">
                  {mockTaskTitle}
                </h2>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Variation 3: With Slash Separator */}
      <Card>
        <CardHeader>
          <CardTitle>Variation 3: Slash Separator</CardTitle>
          <CardDescription>Traditional file-path style breadcrumbs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-4 bg-muted/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" className="flex-shrink-0">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  
                  <div className="flex items-center text-sm text-muted-foreground">
                    <span
                      className="hover:underline cursor-pointer"
                      onClick={() => alert(`Navigate to: /w/${mockWorkspaceSlug}/plan/feature-123`)}
                    >
                      {mockFeatureTitle}
                    </span>
                    <Slash className="w-4 h-4 mx-1" />
                    <span>Task</span>
                  </div>
                </div>

                <h2 className="text-lg font-semibold text-foreground truncate">
                  {mockTaskTitle}
                </h2>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Variation 4: Inline with title */}
      <Card>
        <CardHeader>
          <CardTitle>Variation 4: Inline Breadcrumbs</CardTitle>
          <CardDescription>Breadcrumbs on same line as title (horizontal layout)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-4 bg-muted/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Button variant="ghost" size="sm" className="flex-shrink-0">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex items-center text-sm text-muted-foreground flex-shrink-0">
                    <span
                      className="hover:underline cursor-pointer"
                      onClick={() => alert(`Navigate to: /w/${mockWorkspaceSlug}/plan/feature-123`)}
                    >
                      {mockFeatureTitle}
                    </span>
                    <ChevronRight className="w-4 h-4 mx-1" />
                  </div>
                  
                  <h2 className="text-lg font-semibold text-foreground truncate">
                    {mockTaskTitle}
                  </h2>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Variation 5: Badge Style */}
      <Card>
        <CardHeader>
          <CardTitle>Variation 5: Badge Style with Background</CardTitle>
          <CardDescription>More prominent feature link with badge styling</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg p-4 bg-muted/20">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" className="flex-shrink-0">
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className="px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer transition-colors"
                      onClick={() => alert(`Navigate to: /w/${mockWorkspaceSlug}/plan/feature-123`)}
                    >
                      {mockFeatureTitle}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Task</span>
                  </div>
                </div>

                <h2 className="text-lg font-semibold text-foreground truncate">
                  {mockTaskTitle}
                </h2>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comparison Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Visual Comparison</CardTitle>
          <CardDescription>All variations side by side</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* V1 */}
            <div className="border-l-4 border-blue-500 pl-4 py-2 bg-muted/20 rounded-r">
              <div className="text-xs font-semibold text-blue-600 mb-1">V1: › Chevron</div>
              <div className="text-sm text-muted-foreground">
                <span className="hover:underline cursor-pointer">{mockFeatureTitle}</span>
                <span className="mx-2">›</span>
                <span>Task</span>
              </div>
            </div>

            {/* V2 */}
            <div className="border-l-4 border-green-500 pl-4 py-2 bg-muted/20 rounded-r">
              <div className="text-xs font-semibold text-green-600 mb-1">V2: ChevronRight Icon</div>
              <div className="flex items-center text-sm text-muted-foreground">
                <span className="hover:underline cursor-pointer">{mockFeatureTitle}</span>
                <ChevronRight className="w-4 h-4 mx-1" />
                <span>Task</span>
              </div>
            </div>

            {/* V3 */}
            <div className="border-l-4 border-purple-500 pl-4 py-2 bg-muted/20 rounded-r">
              <div className="text-xs font-semibold text-purple-600 mb-1">V3: Slash Icon</div>
              <div className="flex items-center text-sm text-muted-foreground">
                <span className="hover:underline cursor-pointer">{mockFeatureTitle}</span>
                <Slash className="w-4 h-4 mx-1" />
                <span>Task</span>
              </div>
            </div>

            {/* V4 */}
            <div className="border-l-4 border-orange-500 pl-4 py-2 bg-muted/20 rounded-r">
              <div className="text-xs font-semibold text-orange-600 mb-1">V4: Inline Layout</div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground hover:underline cursor-pointer">
                  {mockFeatureTitle}
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                <span className="text-lg font-semibold">{mockTaskTitle}</span>
              </div>
            </div>

            {/* V5 */}
            <div className="border-l-4 border-pink-500 pl-4 py-2 bg-muted/20 rounded-r">
              <div className="text-xs font-semibold text-pink-600 mb-1">V5: Badge Style</div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer text-sm">
                  {mockFeatureTitle}
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Task</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="text-blue-900 dark:text-blue-100">Notes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
          <p><strong>Current Implementation:</strong> Variation 1 (› chevron) - Matches the phase page style</p>
          <p><strong>Recommendation:</strong> V2 (ChevronRight icon) provides better visual consistency with icons used elsewhere</p>
          <p><strong>Alternative:</strong> V5 (Badge style) if you want feature to be more prominent and visually distinct</p>
          <p className="pt-2 border-t border-blue-200 dark:border-blue-800">
            Click any feature title to see navigation behavior in action
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
