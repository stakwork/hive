"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
    ProjectInfoForm,
    RepositoryForm,
    SwarmForm,
    EnvironmentForm,
    ServicesForm,
    StakgraphSettings,
    ProjectInfoData,
    RepositoryData,
    SwarmData,
    EnvironmentData,
    ServicesData,
} from "@/components/stakgraph";
import { EnvironmentVariable } from "@/types/wizard";

export default function StakgraphPage() {
    const { slug } = useWorkspace();
    const [formData, setFormData] = useState<StakgraphSettings>({
        name: "",
        description: "",
        repositoryUrl: "",
        swarmUrl: "",
        swarmSecretAlias: "",
        poolName: "",
        poolApiKey: "",
        environmentVariables: [],
        services: [],
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [saved, setSaved] = useState(false);

    // Environment variables for the EnvironmentForm
    const [envVars, setEnvVars] = useState<
        Array<{ key: string; value: string; show: boolean }>
    >([]);

    const { toast } = useToast();

    // Form change handlers for each section
    const handleProjectInfoChange = useCallback(
        (data: Partial<ProjectInfoData>) => {
            setFormData((prev) => ({ ...prev, ...data }));
            setSaved(false);
            // Clear errors for changed fields
            if (data.name !== undefined && errors.name) {
                setErrors((prev) => ({ ...prev, name: "" }));
            }
            if (data.description !== undefined && errors.description) {
                setErrors((prev) => ({ ...prev, description: "" }));
            }
        },
        [errors.name, errors.description]
    );

    const handleRepositoryChange = useCallback(
        (data: Partial<RepositoryData>) => {
            setFormData((prev) => ({ ...prev, ...data }));
            setSaved(false);
            // Clear errors for changed fields
            if (data.repositoryUrl !== undefined && errors.repositoryUrl) {
                setErrors((prev) => ({ ...prev, repositoryUrl: "" }));
            }
        },
        [errors.repositoryUrl]
    );

    const handleSwarmChange = useCallback(
        (data: Partial<SwarmData>) => {
            setFormData((prev) => ({ ...prev, ...data }));
            setSaved(false);
            // Clear errors for changed fields
            if (data.swarmUrl !== undefined && errors.swarmUrl) {
                setErrors((prev) => ({ ...prev, swarmUrl: "" }));
            }
            if (
                data.swarmSecretAlias !== undefined &&
                errors.swarmSecretAlias
            ) {
                setErrors((prev) => ({ ...prev, swarmSecretAlias: "" }));
            }
            if (data.poolApiKey !== undefined && errors.poolApiKey) {
                setErrors((prev) => ({ ...prev, poolApiKey: "" }));
            }
        },
        [errors.swarmUrl, errors.swarmSecretAlias, errors.poolApiKey]
    );

    const handleEnvironmentChange = useCallback(
        (data: Partial<EnvironmentData>) => {
            setFormData((prev) => ({ ...prev, ...data }));
            setSaved(false);
            // Clear errors for changed fields
            if (data.poolName !== undefined && errors.poolName) {
                setErrors((prev) => ({ ...prev, poolName: "" }));
            }
            if (data.poolApiKey !== undefined && errors.poolApiKey) {
                setErrors((prev) => ({ ...prev, poolApiKey: "" }));
            }
        },
        [errors.poolName, errors.poolApiKey]
    );

    const handleServicesChange = useCallback((data: Partial<ServicesData>) => {
        setFormData((prev) => ({ ...prev, ...data }));
        setSaved(false);
    }, []);

    const handleEnvVarsChange = useCallback(
        (newEnvVars: Array<{ key: string; value: string; show: boolean }>) => {
            setEnvVars(newEnvVars);
            setSaved(false);
        },
        []
    );

    // Load existing settings on component mount
    useEffect(() => {
        const loadSettings = async () => {
            if (!slug) return;

            try {
                setInitialLoading(true);
                const response = await fetch(
                    `/api/workspaces/${slug}/stakgraph`
                );

                if (response.ok) {
                    const result = await response.json();
                    if (result.success && result.data) {
                        const settings = result.data;
                        setFormData({
                            name: settings.name || "",
                            description: settings.description || "",
                            repositoryUrl: settings.repositoryUrl || "",
                            swarmUrl: settings.swarmUrl || "",
                            swarmSecretAlias: settings.swarmSecretAlias || "",
                            poolName: settings.poolName || "",
                            poolApiKey: settings.poolApiKey || "",
                            environmentVariables:
                                settings.environmentVariables || [],
                            services: settings.services || [],
                            status: settings.status,
                            lastUpdated: settings.lastUpdated,
                        });

                        // Also update the environment variables state
                        if (
                            settings.environmentVariables &&
                            Array.isArray(settings.environmentVariables)
                        ) {
                            setEnvVars(
                                settings.environmentVariables.map(
                                    (env: EnvironmentVariable) => ({
                                        key: env.key,
                                        value: env.value,
                                        show: false,
                                    })
                                )
                            );
                        }
                    }
                } else if (response.status === 404) {
                    // No swarm found - this is expected for workspaces without swarms
                    console.log("No swarm found for this workspace yet");
                } else {
                    console.error("Failed to load stakgraph settings");
                }
            } catch (error) {
                console.error("Error loading stakgraph settings:", error);
            } finally {
                setInitialLoading(false);
            }
        };

        loadSettings();
    }, [slug]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!slug) {
            toast({
                title: "Error",
                description: "Workspace not found",
                variant: "destructive",
            });
            return;
        }

        // Reset previous states
        setErrors({});
        setSaved(false);

        // Validation
        const newErrors: Record<string, string> = {};

        if (!formData.name.trim()) {
            newErrors.name = "Name is required";
        }
        if (!formData.description.trim()) {
            newErrors.description = "Description is required";
        }
        if (!formData.repositoryUrl.trim()) {
            newErrors.repositoryUrl = "Repository URL is required";
        } else if (!isValidUrl(formData.repositoryUrl.trim())) {
            newErrors.repositoryUrl = "Please enter a valid URL";
        }

        if (!formData.swarmUrl.trim()) {
            newErrors.swarmUrl = "Swarm URL is required";
        } else if (!isValidUrl(formData.swarmUrl.trim())) {
            newErrors.swarmUrl = "Please enter a valid URL";
        }

        if (!formData.swarmSecretAlias.trim()) {
            newErrors.swarmSecretAlias = "Swarm API Key is required";
        }

        if (!formData.poolName.trim()) {
            newErrors.poolName = "Pool Name is required";
        }
        if (!formData.poolApiKey.trim()) {
            newErrors.poolApiKey = "Pool API Key is required";
        }

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        setLoading(true);

        try {
            const payload = {
                name: formData.name.trim(),
                description: formData.description.trim(),
                repositoryUrl: formData.repositoryUrl.trim(),
                swarmUrl: formData.swarmUrl.trim(),
                swarmSecretAlias: formData.swarmSecretAlias.trim(),
                poolName: formData.poolName.trim(),
                poolApiKey: formData.poolApiKey.trim(),
                environmentVariables: envVars.map((env) => ({
                    key: env.key,
                    value: env.value,
                })),
                services: formData.services,
            };

            const response = await fetch(`/api/workspaces/${slug}/stakgraph`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (response.ok && result.success) {
                setSaved(true);
                toast({
                    title: "Configuration saved",
                    description:
                        "Your Stakgraph settings have been saved successfully!",
                    variant: "default",
                });

                // Update form data with response data
                if (result.data) {
                    setFormData((prev) => ({
                        ...prev,
                        status: result.data.status,
                        lastUpdated: result.data.updatedAt,
                    }));
                }
            } else {
                // Handle validation errors
                if (result.error === "VALIDATION_ERROR" && result.details) {
                    setErrors(result.details);
                } else {
                    setErrors({
                        general:
                            result.message ||
                            "Failed to save configuration. Please try again.",
                    });
                }

                toast({
                    title: "Error",
                    description:
                        result.message || "Failed to save configuration",
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error("Failed to save configuration:", error);
            setErrors({
                general: "Failed to save configuration. Please try again.",
            });
            toast({
                title: "Error",
                description: "Network error occurred while saving",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    const isValidUrl = (string: string) => {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    };

    if (initialLoading) {
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-3">
                    {/* <Network className="w-8 h-8 text-primary" /> */}
                    <div>
                        <h1 className="text-3xl font-bold">
                            Stakgraph Configuration
                        </h1>
                        <p className="text-muted-foreground">
                            Configure your settings for Stakgraph integration
                        </p>
                    </div>
                </div>
                <Card className="max-w-2xl">
                    <CardContent className="flex items-center justify-center py-8">
                        <div className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Loading settings...</span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                {/* <Network className="w-8 h-8 text-primary" /> */}
                <div>
                    <h1 className="text-3xl font-bold">
                        Stakgraph Configuration
                    </h1>
                    <p className="text-muted-foreground">
                        Configure your settings for Stakgraph integration
                    </p>
                    {/* Removed Swarm Status and Last updated */}
                </div>
            </div>

            {/* Subtle: Create Stakgraph section (only if all fields are empty, with smooth animation) */}
            <AnimatePresence>
                {/* FIXME: CHECK FOR WIZARD STATE IF COMPLETED OR NOT */}
                {
                    <motion.div
                        key="create-stakgraph-prompt"
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.25 }}
                        className="max-w-2xl bg-muted/40 rounded-md px-4 py-2 mb-2 flex items-center gap-3"
                    >
                        <span className="text-sm text-muted-foreground">
                            Don&apos;t have a Stakgraph configuration?&nbsp;
                        </span>
                        <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="px-2 h-7"
                        >
                            <Link href={slug ? `/w/${slug}/code-graph` : "#"}>
                                Create Stakgraph
                            </Link>
                        </Button>
                    </motion.div>
                }
            </AnimatePresence>

            <Card className="max-w-2xl">
                <CardHeader>
                    <CardTitle>Stakgraph Settings</CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {errors.general && (
                            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                                <p className="text-sm text-destructive">
                                    {errors.general}
                                </p>
                            </div>
                        )}

                        {saved && (
                            <div className="p-3 rounded-md bg-green-50 border border-green-200">
                                <p className="text-sm text-green-700">
                                    Configuration saved successfully!
                                </p>
                            </div>
                        )}

                        <div className="space-y-6">
                            <ProjectInfoForm
                                data={{
                                    name: formData.name,
                                    description: formData.description,
                                }}
                                errors={errors}
                                loading={loading}
                                onChange={handleProjectInfoChange}
                            />

                            <RepositoryForm
                                data={{ repositoryUrl: formData.repositoryUrl }}
                                errors={errors}
                                loading={loading}
                                onChange={handleRepositoryChange}
                            />

                            <SwarmForm
                                data={{
                                    swarmUrl: formData.swarmUrl,
                                    swarmSecretAlias: formData.swarmSecretAlias,
                                    poolApiKey: formData.poolApiKey,
                                }}
                                errors={errors}
                                loading={loading}
                                onChange={handleSwarmChange}
                            />

                            <EnvironmentForm
                                data={{
                                    poolName: formData.poolName,
                                    poolApiKey: formData.poolApiKey,
                                    environmentVariables:
                                        formData.environmentVariables,
                                }}
                                errors={errors}
                                loading={loading}
                                onChange={handleEnvironmentChange}
                                onEnvVarsChange={handleEnvVarsChange}
                            />

                            <ServicesForm
                                data={{ services: formData.services }}
                                loading={loading}
                                onChange={handleServicesChange}
                            />
                        </div>

                        <Button type="submit" disabled={loading}>
                            {loading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="mr-2 h-4 w-4" />
                                    Save
                                </>
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
