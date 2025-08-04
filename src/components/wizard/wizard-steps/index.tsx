import { CompletionStep } from "./completion-step";
import { EnvironmentSetupStep } from "./environment-setup-step";
import { GraphInfrastructureStep } from "./graph-infrastructure-step";
import { IngestCodeStep } from "./ingest-code-step";
import { ProjectNameStep } from "./project-name-step";
import { RepositorySelectionStep } from "./repositorie-selection-step";
import { ReviewPoolEnvironmentStep } from "./review-pool-environment-step";
import { ServicesStep } from "./services-step";
import { StakworkSetupStep } from "./stakwork-setup-step";
import { WelcomeStep } from "./welcome-step";

export const componentsMap: Record<string, React.ComponentType<any>> = {
  WELCOME: WelcomeStep,
  REPOSITORY_SELECT: RepositorySelectionStep,
  PROJECT_NAME: ProjectNameStep,
  GRAPH_INFRASTRUCTURE: GraphInfrastructureStep,
  INGEST_CODE: IngestCodeStep,
  ADD_SERVICES: ServicesStep,
  ENVIRONMENT_SETUP: EnvironmentSetupStep,
  REVIEW_POOL_ENVIRONMENT: ReviewPoolEnvironmentStep,
  STAKWORK_SETUP: StakworkSetupStep,
  COMPLETION: CompletionStep,
};
