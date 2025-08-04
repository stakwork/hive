"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggleDropdown } from "./theme-toggle-dropdown";

export function ThemeSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Theme Settings
        </CardTitle>
        <CardDescription>
          Customize the appearance of your dashboard
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <label className="text-sm font-medium text-foreground">
                Choose Theme
              </label>
              <ThemeToggleDropdown />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Select your preferred theme. System will automatically match your
              operating system&apos;s appearance.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
