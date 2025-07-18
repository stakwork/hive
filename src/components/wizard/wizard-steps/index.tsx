import { EnvironmentSetupStep } from "./environment-setup-step";
import { GraphInfrastructureStep } from "./graph-infrastructure-step";
import { IngestCodeStep } from "./ingest-code-step";
import { ProjectNameStep } from "./project-name-step";
import { RepositorySelectionStep } from "./repositorie-selection-step";
import ReviewPoolEnvironmentStep from "./review-pool-environment-step";
import ServicesStep from "./services-step";
import { StakworkSetupStep } from "./stakwork-setup-step";
import { WelcomeStep } from "./welcome-step";

export const componentsMap: Record<number, React.ComponentType<any>> = {
    1: WelcomeStep,
    2: RepositorySelectionStep,
    3: ProjectNameStep,
    4: GraphInfrastructureStep,
    5: IngestCodeStep,
    6: ServicesStep,
    7: EnvironmentSetupStep,
    8: ReviewPoolEnvironmentStep,
    9: StakworkSetupStep,
};
