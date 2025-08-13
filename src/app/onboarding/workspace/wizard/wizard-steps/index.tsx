import { GithubAuthStep } from "./github-auth-step";
import { ProjectNameSetupStep } from "./project-name-setup";
import { WelcomeStep } from "./welcome-step";

export const componentsMap: Record<string, React.ComponentType<any>> = {
  WELCOME: WelcomeStep,
  GITHUB_AUTH: GithubAuthStep,
  PROJECT_NAME: ProjectNameSetupStep,
};
