import { WelcomeStep } from "./welcome-step";

export const componentsMap: Record<string, React.ComponentType<{ onNext: () => void }>> = {
  WELCOME: WelcomeStep,
};
