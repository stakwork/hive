import {
  EnvironmentData,
  ProjectInfoData,
  RepositoryData,
  ServiceDataConfig,
  StakgraphSettings,
  SwarmData,
} from "@/components/stakgraph/types";
import { toast } from "sonner";
import { EnvironmentVariable } from "@/types/wizard";
import { getPM2AppsContent, maskEnvVarsInPM2Config } from "@/utils/devContainerUtils";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import { createRequestManager, isAbortError } from "@/utils/request-manager";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

const initialFormData: StakgraphSettings = {
  name: "",
  description: "",
  repositories: [{ repositoryUrl: "", branch: "main", name: "", codeIngestionEnabled: true, docsEnabled: true, mocksEnabled: true }],
  swarmUrl: "",
  swarmSecretAlias: "",
  swarmApiKey: "",
  poolName: "",
  poolCpu: "2",
  poolMemory: "8Gi",
  environmentVariables: [],
  services: [],
  containerFiles: {},
};

const initialState = {
  formData: initialFormData,
  errors: {} as Record<string, string>,
  loading: false,
  initialLoading: true,
  saved: false,
  envVars: [] as Array<{ name: string; value: string; show?: boolean }>,
  currentWorkspaceSlug: null as string | null,
};

const requestManager = createRequestManager();

type StakgraphStore = {
  // State
  formData: StakgraphSettings;
  errors: Record<string, string>;
  loading: boolean;
  initialLoading: boolean;
  saved: boolean;
  envVars: Array<{ name: string; value: string; show?: boolean }>;
  currentWorkspaceSlug: string | null;

  // Actions
  loadSettings: (slug: string) => Promise<void>;
  saveSettings: (slug: string) => Promise<void>;
  resetForm: () => void;

  // Form change handlers
  handleProjectInfoChange: (data: Partial<ProjectInfoData>) => void;
  handleRepositoryChange: (data: Partial<RepositoryData>) => void;
  handleSwarmChange: (data: Partial<SwarmData>) => void;
  handleEnvironmentChange: (data: Partial<EnvironmentData>) => void;
  handleServicesChange: (services: ServiceDataConfig[]) => void;
  handleFileChange: (fileName: string, content: string) => void;
  handleEnvVarsChange: (newEnvVars: Array<{ name: string; value: string; show?: boolean }>) => void;

  // Setters
  setErrors: (errors: Record<string, string>) => void;
  setLoading: (loading: boolean) => void;
  setInitialLoading: (loading: boolean) => void;
  setSaved: (saved: boolean) => void;
};

const isValidUrl = (string: string) => {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
};

export const useStakgraphStore = create<StakgraphStore>()(
  devtools((set, get) => ({
    // Initial state
    ...initialState,

    // Load existing settings
    loadSettings: async (slug: string) => {
      if (!slug) return;
      const state = get();

      if (state.currentWorkspaceSlug !== slug) {
        set({
          ...initialState,
          currentWorkspaceSlug: slug,
          initialLoading: true,
        });
      }

      try {
        const signal = requestManager.getSignal();
        const response = await fetch(`/api/workspaces/${slug}/stakgraph`, {
          signal,
        });

        if (get().currentWorkspaceSlug !== slug) return;

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            const settings = result.data;

            console.log("result.data>>>>", result.data);

            const files = Object.entries(settings.containerFiles || {}).reduce(
              (acc, curr) => {
                const fileName = curr[0];
                let content = atob(curr[1] as string);
                // Mask env var values in PM2 config for display
                if (fileName === "pm2.config.js") {
                  content = maskEnvVarsInPM2Config(content);
                }
                acc[fileName] = content;
                return acc;
              },
              {} as Record<string, string>,
            );

            const newFormData: StakgraphSettings = {
              name: settings.name || "",
              description: settings.description || "",
              repositories: settings.repositories || [{ repositoryUrl: "", branch: "main", name: "", codeIngestionEnabled: true, docsEnabled: true, mocksEnabled: true }],
              swarmUrl: settings.swarmUrl || "",
              swarmSecretAlias: settings.swarmSecretAlias || "",
              swarmApiKey: settings.swarmApiKey || "",
              poolName: settings.poolName || "",
              poolCpu: settings.poolCpu || "2",
              poolMemory: settings.poolMemory || "8Gi",
              environmentVariables: settings.environmentVariables || [],
              services: settings.services || [],
              status: settings.status,
              lastUpdated: settings.lastUpdated,
              containerFiles: files,
              webhookEnsured: Boolean(settings.webhookEnsured),
            };

            console.log("newFormData", newFormData);

            set({ formData: newFormData });

            // Also update the environment variables state
            if (settings.environmentVariables && Array.isArray(settings.environmentVariables)) {
              const newEnvVars = settings.environmentVariables.map((env: EnvironmentVariable) => ({
                name: env.name,
                value: env.value,
                show: false,
              }));
              set({ envVars: newEnvVars });
            }
          }
        } else if (response.status === 404) {
          // No swarm found - this is expected for workspaces without swarms
          console.log("No swarm found for this workspace yet");
        } else {
          console.error("Failed to load stakgraph settings");
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        console.error("Error loading stakgraph settings:", error);
      } finally {
        if (requestManager.isAborted() || get().currentWorkspaceSlug !== slug) {
          return;
        }

        set({ initialLoading: false });
      }
    },

    // Save settings
    saveSettings: async (slug: string) => {
      const state = get();

      if (!slug) {
        toast.error("Error", {
          description: "Workspace not found",
        });
        return;
      }

      // Reset previous states
      set({ errors: {}, saved: false });

      const newErrors: Record<string, string> = {};
      if (!state.formData.name.trim()) {
        newErrors.name = "Name is required";
      }

      if (!state.formData.repositories || state.formData.repositories.length === 0) {
        newErrors.repositories = "At least one repository is required";
      } else {
        state.formData.repositories.forEach((repo, index) => {
          if (!repo.repositoryUrl.trim()) {
            newErrors[`repositories.${index}.url`] = "Repository URL is required";
          } else if (!isValidUrl(repo.repositoryUrl.trim())) {
            newErrors[`repositories.${index}.url`] = "Please enter a valid URL";
          }
          if (!repo.branch.trim()) {
            newErrors[`repositories.${index}.branch`] = "Branch is required";
          }
        });
      }

      if (!state.formData.swarmUrl.trim()) {
        newErrors.swarmUrl = "Swarm URL is required";
      } else if (!isValidUrl(state.formData.swarmUrl.trim())) {
        newErrors.swarmUrl = "Please enter a valid URL";
      }

      if (!state.formData.swarmSecretAlias.trim()) {
        newErrors.swarmSecretAlias = "Swarm API Key is required";
      }

      if (!state.formData.poolName.trim()) {
        newErrors.poolName = "Pool Name is required";
      }

      if (Object.keys(newErrors).length > 0) {
        set({ errors: newErrors });
        return;
      }

      set({ loading: true });

      try {
        // Extract repository name from URL for dev container paths
        // The cwd path should always be based on the actual repo name, not the project name
        const primaryRepo = state.formData.repositories[0];
        const repoName = (() => {
          if (!primaryRepo?.repositoryUrl) return state.formData.name;
          try {
            const { repo } = parseGithubOwnerRepo(primaryRepo.repositoryUrl);
            return repo;
          } catch {
            // Fallback to extracting from URL pattern if parseGithubOwnerRepo fails
            const match = primaryRepo.repositoryUrl.match(/\/([^/]+?)(?:\.git)?$/);
            return match?.[1]?.replace(/\.git$/i, "") || state.formData.name;
          }
        })();

        // Get global env vars (those without a serviceName) for PM2 config
        const globalEnvVars = state.envVars.map((env) => ({
          name: env.name,
          value: env.value,
        }));

        const containerFiles = {
          ...state.formData.containerFiles,
          "pm2.config.js": getPM2AppsContent(repoName, state.formData.services, globalEnvVars)?.content || "",
        };

        const base64EncodedFiles = Object.entries(containerFiles).reduce(
          (acc, [name, content]) => {
            acc[name] = Buffer.from(content).toString("base64");
            return acc;
          },
          {} as Record<string, string>,
        );

        const payload: Partial<StakgraphSettings> = {
          name: state.formData.name.trim(),
          description: state.formData.description.trim(),
          repositories: state.formData.repositories,
          swarmUrl: state.formData.swarmUrl.trim(),
          swarmSecretAlias: state.formData.swarmSecretAlias.trim(),
          poolName: state.formData.poolName.trim(),
          poolCpu: state.formData.poolCpu,
          poolMemory: state.formData.poolMemory,
          environmentVariables: state.envVars.map((env) => ({
            name: env.name,
            value: env.value,
          })),
          services: state.formData.services,
          containerFiles: base64EncodedFiles,
        };
        if (state.formData.swarmApiKey) {
          payload.swarmApiKey = state.formData.swarmApiKey.trim();
        }

        const response = await fetch(`/api/workspaces/${slug}/stakgraph`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (response.ok && result.success) {
          set({ saved: true });
          toast.success("Configuration saved", {
            description: "Your pool settings have been saved successfully!",
          });

          // Update form data with response data
          if (result.data) {
            set((state) => ({
              formData: {
                ...state.formData,
                status: result.data.status,
                lastUpdated: result.data.updatedAt,
              },
            }));
          }
        } else {
          // Handle validation errors
          if (result.error === "VALIDATION_ERROR" && result.details) {
            set({ errors: result.details });
          } else if (result.error === "INSUFFICIENT_PERMISSIONS") {
            set({
              errors: {
                general: result.message || "Admin access required to manage webhooks on this repository",
              },
            });
          } else {
            set({
              errors: {
                general: result.message || "Failed to save configuration. Please try again.",
              },
            });
          }

          toast.error(result.error === "INSUFFICIENT_PERMISSIONS" ? "Permission Required" : "Error", {
            description: result.message || "Failed to save configuration",
          });
        }
      } catch (error) {
        console.error("Failed to save configuration:", error);
        set({
          errors: {
            general: "Failed to save configuration. Please try again.",
          },
        });
        toast.error("Error", {
          description: "Network error occurred while saving",
        });
      } finally {
        set({ loading: false });
      }
    },

    // Form change handlers
    handleProjectInfoChange: (data: Partial<ProjectInfoData>) => {
      const state = get();
      set({
        formData: { ...state.formData, ...data },
        saved: false,
      });

      // Clear errors for changed fields
      const newErrors = { ...state.errors };
      if (data.name !== undefined && newErrors.name) {
        delete newErrors.name;
      }
      if (data.description !== undefined && newErrors.description) {
        delete newErrors.description;
      }
      if (Object.keys(newErrors).length !== Object.keys(state.errors).length) {
        set({ errors: newErrors });
      }
    },

    handleRepositoryChange: (data: Partial<RepositoryData>) => {
      const state = get();

      const updatedData: Partial<StakgraphSettings> = {};

      if (data.repositories) {
        updatedData.repositories = data.repositories;
      }

      set({
        formData: { ...state.formData, ...updatedData },
        saved: false,
      });

      const newErrors = { ...state.errors };
      if (data.repositories !== undefined) {
        if (newErrors.repositoryUrl) delete newErrors.repositoryUrl;
      }
      if (Object.keys(newErrors).length !== Object.keys(state.errors).length) {
        set({ errors: newErrors });
      }
    },

    handleSwarmChange: (data: Partial<SwarmData>) => {
      const state = get();
      set({
        formData: { ...state.formData, ...data },
        saved: false,
      });

      // Clear errors for changed fields
      const newErrors = { ...state.errors };
      if (data.swarmUrl !== undefined && newErrors.swarmUrl) {
        delete newErrors.swarmUrl;
      }
      if (data.swarmSecretAlias !== undefined && newErrors.swarmSecretAlias) {
        delete newErrors.swarmSecretAlias;
      }
      if (data.swarmApiKey !== undefined && newErrors.swarmApiKey) {
        delete newErrors.swarmApiKey;
      }
      if (Object.keys(newErrors).length !== Object.keys(state.errors).length) {
        set({ errors: newErrors });
      }
    },

    handleEnvironmentChange: (data: Partial<EnvironmentData>) => {
      const state = get();
      set({
        formData: { ...state.formData, ...data },
        saved: false,
      });

      // Clear errors for changed fields
      const newErrors = { ...state.errors };
      if (data.poolName !== undefined && newErrors.poolName) {
        delete newErrors.poolName;
      }
      if (data.poolCpu !== undefined && newErrors.poolCpu) {
        delete newErrors.poolCpu;
      }
      if (data.poolMemory !== undefined && newErrors.poolMemory) {
        delete newErrors.poolMemory;
      }
      if (Object.keys(newErrors).length !== Object.keys(state.errors).length) {
        set({ errors: newErrors });
      }
    },

    handleServicesChange: (services: ServiceDataConfig[]) => {
      const state = get();
      console.log("Store receiving services:", services); // Debug log
      set({
        formData: { ...state.formData, services: services },
        saved: false,
      });
    },

    handleEnvVarsChange: (newEnvVars: Array<{ name: string; value: string; show?: boolean }>) => {
      set({
        envVars: newEnvVars,
        saved: false,
      });
    },

    handleFileChange: (fileName: string, content: string) => {
      const state = get();
      set({
        formData: {
          ...state.formData,
          containerFiles: {
            ...state.formData.containerFiles,
            [fileName]: content,
          },
        },
        saved: false,
      });
    },

    // Setters
    setErrors: (errors) => set({ errors }),
    setLoading: (loading) => set({ loading }),
    setInitialLoading: (loading) => set({ initialLoading: loading }),
    setSaved: (saved) => set({ saved }),
    resetForm: () => {
      requestManager.reset();
      set({
        ...initialState,
        formData: JSON.parse(JSON.stringify(initialFormData)),
        envVars: [],
      });
    },
  })),
);
