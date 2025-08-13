import { CompletionStep } from "./completion-step";
import { EnvironmentSetupStep } from "./environment-setup-step";
import { GraphInfrastructureStep } from "./graph-infrastructure-step";
import { IngestCodeStep } from "./ingest-code-step";
import { ReviewPoolEnvironmentStep } from "./review-pool-environment-step";
import { ServicesStep } from "./services-step";
import { StakworkSetupStep } from "./stakwork-setup-step";

export const componentsMap: Record<string, React.ComponentType<any>> = {
  GRAPH_INFRASTRUCTURE: GraphInfrastructureStep,
  INGEST_CODE: IngestCodeStep,
  ADD_SERVICES: ServicesStep,
  ENVIRONMENT_SETUP: EnvironmentSetupStep,
  REVIEW_POOL_ENVIRONMENT: ReviewPoolEnvironmentStep,
  STAKWORK_SETUP: StakworkSetupStep,
  COMPLETION: CompletionStep,
};
