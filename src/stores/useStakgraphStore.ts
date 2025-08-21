import {
  EnvironmentData,
  ProjectInfoData,
  RepositoryData,
  ServiceDataConfig,
  StakgraphSettings,
  SwarmData,
} from "@/components/stakgraph/types";
import { ToastProps } from "@/components/ui/toast";
import { EnvironmentVariable } from "@/types/wizard";
import { getPM2AppsContent } from "@/utils/devContainerUtils";
import { createRequestManager, isAbortError } from "@/utils/request-manager";
import { create } from "zustand";
import { devtools } from "zustand/middleware";

const initialFormData: StakgraphSettings = {
  name: "",
  description: "",
  repositoryUrl: "",
  swarmUrl: "",
  swarmSecretAlias: "",
  swarmApiKey: "",
  poolName: "",
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
  saveSettings: (
    slug: string,
    toast: (opts: Omit<ToastProps, "open" | "onOpenChange">) => void,
  ) => Promise<void>;
  resetForm: () => void;

  // Form change handlers
  handleProjectInfoChange: (data: Partial<ProjectInfoData>) => void;
  handleRepositoryChange: (data: Partial<RepositoryData>) => void;
  handleSwarmChange: (data: Partial<SwarmData>) => void;
  handleEnvironmentChange: (data: Partial<EnvironmentData>) => void;
  handleServicesChange: (services: ServiceDataConfig[]) => void;
  handleFileChange: (fileName: string, content: string) => void;
  handleEnvVarsChange: (
    newEnvVars: Array<{ name: string; value: string; show?: boolean }>,
  ) => void;

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
                acc[curr[0]] = atob(curr[1] as string);
                return acc;
              },
              {} as Record<string, string>,
            );

            const newFormData: StakgraphSettings = {
              name: settings.name || "",
              description: settings.description || "",
              repositoryUrl: settings.repositoryUrl || "",
              swarmUrl: settings.swarmUrl || "",
              swarmSecretAlias: settings.swarmSecretAlias || "",
              swarmApiKey: settings.swarmApiKey || "",
              poolName: settings.poolName || "",
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
            if (
              settings.environmentVariables &&
              Array.isArray(settings.environmentVariables)
            ) {
              const newEnvVars = settings.environmentVariables.map(
                (env: EnvironmentVariable) => ({
                  name: env.name,
                  value: env.value,
                  show: false,
                }),
              );
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
    saveSettings: async (
      slug: string,
      toast: (opts: Omit<ToastProps, "open" | "onOpenChange">) => void,
    ) => {
      const state = get();

      if (!slug) {
        toast({
          title: "Error",
          description: "Workspace not found",
          variant: "destructive",
        });
        return;
      }

      // Reset previous states
      set({ errors: {}, saved: false });

      // Validation
      const newErrors: Record<string, string> = {};

      if (!state.formData.name.trim()) {
        newErrors.name = "Name is required";
      }
      if (!state.formData.repositoryUrl.trim()) {
        newErrors.repositoryUrl = "Repository URL is required";
      } else if (!isValidUrl(state.formData.repositoryUrl.trim())) {
        newErrors.repositoryUrl = "Please enter a valid URL";
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
        const containerFiles = {
          ...state.formData.containerFiles,
          "pm2.config.js":
            getPM2AppsContent(state.formData.name, state.formData.services)
              ?.content || "",
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
          repositoryUrl: state.formData.repositoryUrl.trim(),
          swarmUrl: state.formData.swarmUrl.trim(),
          swarmSecretAlias: state.formData.swarmSecretAlias.trim(),
          poolName: state.formData.poolName.trim(),
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
          toast({
            title: "Configuration saved",
            description:
              "Your Stakgraph settings have been saved successfully!",
            variant: "default",
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
          } else {
            set({
              errors: {
                general:
                  result.message ||
                  "Failed to save configuration. Please try again.",
              },
            });
          }

          toast({
            title: "Error",
            description: result.message || "Failed to save configuration",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Failed to save configuration:", error);
        set({
          errors: {
            general: "Failed to save configuration. Please try again.",
          },
        });
        toast({
          title: "Error",
          description: "Network error occurred while saving",
          variant: "destructive",
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
      set({
        formData: { ...state.formData, ...data },
        saved: false,
      });

      // Clear errors for changed fields
      const newErrors = { ...state.errors };
      if (data.repositoryUrl !== undefined && newErrors.repositoryUrl) {
        delete newErrors.repositoryUrl;
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

    handleEnvVarsChange: (
      newEnvVars: Array<{ name: string; value: string; show?: boolean }>,
    ) => {
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
