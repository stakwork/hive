import { Suspense } from "react";
import WorkspaceWizard from "./wizard";

export default async function OnboardingWorkspacePage() {
  return (
    <Suspense>
      <WorkspaceWizard />
    </Suspense>
  );
}
