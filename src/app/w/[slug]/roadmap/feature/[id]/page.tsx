"use client";

import { useRouter, useParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Edit, Trash2, FileText, Sparkles, ArrowLeft } from "lucide-react";
import { UserStoriesTab } from "@/components/roadmap/UserStoriesTab";
import { RequirementsTab } from "@/components/roadmap/RequirementsTab";
// import { EditFeatureDialog } from "@/components/roadmap/EditFeatureDialog";
import React, { useState } from "react";
import type { Feature } from "@/components/roadmap/RoadmapContent";
import ReactMarkdown from "react-markdown";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { X, Plus, Check, Pencil } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Tabs as ShadcnTabs,
    TabsList as ShadcnTabsList,
    TabsTrigger as ShadcnTabsTrigger,
    TabsContent as ShadcnTabsContent,
} from "@/components/ui/tabs";

// TODO: Replace with real feature fetching logic
const mockFeature: Feature = {
    id: "1",
    title: "User Authentication",
    brief: "Implement secure user authentication system with multiple providers",
    status: "in-progress",
    priority: "high",
    userStories: [],
    requirements: [],
    createdAt: new Date(),
    updatedAt: new Date(),
};

export default function FeatureDetailPage() {
    const router = useRouter();
    const params = useParams();
    const workspaceSlug = params.slug as string;
    // TODO: Fetch feature by id
    const feature: Feature = mockFeature; // Replace with real fetch
    const [activeTab, setActiveTab] = useState<string>("overview");

    // Architecture tab state
    const [archMarkdown, setArchMarkdown] = useState<string>(
        `# Sample Architecture\n\n- Use a service-oriented approach\n- Document all endpoints\n\n**Diagram:**\n\n![Sample](https://placehold.co/600x200?text=Architecture+Diagram)`
    );
    const [archEditMode, setArchEditMode] = useState<boolean>(false);
    const [archLinks, setArchLinks] = useState<string[]>([
        "https://github.com/example/repo",
        "https://docs.example.com/architecture",
    ]);
    const [newLink, setNewLink] = useState<string>("");

    const handleAddLink = () => {
        if (newLink.trim() && !archLinks.includes(newLink.trim())) {
            setArchLinks([...archLinks, newLink.trim()]);
            setNewLink("");
        }
    };
    const handleDeleteLink = (idx: number) => {
        setArchLinks(archLinks.filter((_, i) => i !== idx));
    };

    // Tasks tab state
    const [tasks, setTasks] = useState<{ title: string; content: string }[]>(
        []
    );
    const [taskTitle, setTaskTitle] = useState("");
    const [openTaskIdx, setOpenTaskIdx] = useState<number | null>(null);
    const [modalContent, setModalContent] = useState<string>("");
    const [modalTab, setModalTab] = useState<string>("write");
    const handleAddTask = () => {
        if (taskTitle.trim()) {
            setTasks([...tasks, { title: taskTitle.trim(), content: "" }]);
            setTaskTitle("");
        }
    };
    const handleDeleteTask = (idx: number) => {
        setTasks(tasks.filter((_, i) => i !== idx));
    };
    const handleOpenTask = (idx: number) => {
        setOpenTaskIdx(idx);
        setModalContent(tasks[idx].content || "");
        setModalTab("write");
    };
    const handleSaveModal = () => {
        if (openTaskIdx !== null) {
            setTasks(
                tasks.map((t, i) =>
                    i === openTaskIdx ? { ...t, content: modalContent } : t
                )
            );
            setOpenTaskIdx(null);
        }
    };
    const handleCloseModal = () => {
        setOpenTaskIdx(null);
    };
    const handleGenerateTasks = () => {
        // TODO: Integrate AI task generation
        alert("AI task generation coming soon!");
    };

    const getStatusColor = (status: Feature["status"]): string => {
        switch (status) {
            case "planning":
                return "bg-blue-100 text-blue-800 border-blue-200";
            case "in-progress":
                return "bg-yellow-100 text-yellow-800 border-yellow-200";
            case "completed":
                return "bg-green-100 text-green-800 border-green-200";
            case "on-hold":
                return "bg-gray-100 text-gray-800 border-gray-200";
        }
    };

    const getPriorityColor = (priority: Feature["priority"]): string => {
        switch (priority) {
            case "low":
                return "bg-gray-100 text-gray-800 border-gray-200";
            case "medium":
                return "bg-blue-100 text-blue-800 border-blue-200";
            case "high":
                return "bg-red-100 text-red-800 border-red-200";
        }
    };

    return (
        <div className="max-w-4xl mx-auto py-8 px-4">
            <Button
                variant="ghost"
                onClick={() => router.push(`/w/${workspaceSlug}/roadmap`)}
                className="mb-4 flex items-center gap-2"
            >
                <ArrowLeft className="w-4 h-4" /> Back to Roadmap
            </Button>
            <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                    <h1 className="text-3xl font-bold">{feature.title}</h1>
                    <p className="mt-2 text-muted-foreground">
                        {feature.brief}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon">
                        <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                    >
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
            </div>
            <div className="flex gap-2 flex-wrap mb-4">
                <Badge
                    variant="secondary"
                    className={getStatusColor(feature.status)}
                >
                    {feature.status.charAt(0).toUpperCase() +
                        feature.status.slice(1).replace("-", " ")}
                </Badge>
                <Badge
                    variant="outline"
                    className={getPriorityColor(feature.priority)}
                >
                    {feature.priority.charAt(0).toUpperCase() +
                        feature.priority.slice(1)}{" "}
                    Priority
                </Badge>
            </div>
            <Separator className="mb-4" />
            <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="flex-1 flex flex-col overflow-hidden"
            >
                <TabsList className="grid w-full grid-cols-5">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="user-stories">User Stories</TabsTrigger>
                    <TabsTrigger value="requirements">Requirements</TabsTrigger>
                    <TabsTrigger value="architecture">Architecture</TabsTrigger>
                    <TabsTrigger value="tasks">Tasks</TabsTrigger>
                </TabsList>
                <div className="flex-1 overflow-hidden">
                    <TabsContent value="overview" className="mt-4 space-y-4">
                        <div className="space-y-4">
                            <div>
                                <h3 className="text-lg font-semibold mb-2">
                                    Feature Brief
                                </h3>
                                <p className="text-muted-foreground leading-relaxed">
                                    {feature.brief}
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <h4 className="font-medium mb-2">Status</h4>
                                    <Badge
                                        variant="secondary"
                                        className={getStatusColor(
                                            feature.status
                                        )}
                                    >
                                        {feature.status
                                            .charAt(0)
                                            .toUpperCase() +
                                            feature.status
                                                .slice(1)
                                                .replace("-", " ")}
                                    </Badge>
                                </div>
                                <div>
                                    <h4 className="font-medium mb-2">
                                        Priority
                                    </h4>
                                    <Badge
                                        variant="outline"
                                        className={getPriorityColor(
                                            feature.priority
                                        )}
                                    >
                                        {feature.priority
                                            .charAt(0)
                                            .toUpperCase() +
                                            feature.priority.slice(1)}{" "}
                                        Priority
                                    </Badge>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <h4 className="font-medium mb-2">
                                        User Stories
                                    </h4>
                                    <p className="text-2xl font-bold text-primary">
                                        {feature.userStories.length}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Stories defined
                                    </p>
                                </div>
                                <div>
                                    <h4 className="font-medium mb-2">
                                        Requirements
                                    </h4>
                                    <p className="text-2xl font-bold text-primary">
                                        {feature.requirements.length}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        Requirements documented
                                    </p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
                                <div>
                                    <span className="font-medium">
                                        Created:
                                    </span>{" "}
                                    {feature.createdAt.toLocaleDateString()}
                                </div>
                                <div>
                                    <span className="font-medium">
                                        Last Updated:
                                    </span>{" "}
                                    {feature.updatedAt.toLocaleDateString()}
                                </div>
                            </div>
                        </div>
                    </TabsContent>
                    <TabsContent
                        value="user-stories"
                        className="mt-4 flex-1 overflow-hidden"
                    >
                        {/* TODO: Pass correct props for feature/user stories */}
                        <UserStoriesTab
                            feature={feature}
                            onUpdateFeature={() => {}}
                        />
                    </TabsContent>
                    <TabsContent
                        value="requirements"
                        className="mt-4 flex-1 overflow-hidden"
                    >
                        {/* TODO: Pass correct props for feature/requirements */}
                        <RequirementsTab
                            feature={feature}
                            onUpdateFeature={() => {}}
                        />
                    </TabsContent>
                    <TabsContent
                        value="architecture"
                        className="mt-4 flex-1 overflow-hidden"
                    >
                        <div className="space-y-8">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-lg font-semibold">
                                        Architecture Notes
                                    </h3>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() =>
                                            setArchEditMode((v) => !v)
                                        }
                                        aria-label={
                                            archEditMode ? "Preview" : "Edit"
                                        }
                                    >
                                        {archEditMode ? (
                                            <Check className="w-5 h-5" />
                                        ) : (
                                            <Pencil className="w-5 h-5" />
                                        )}
                                    </Button>
                                </div>
                                {archEditMode ? (
                                    <Textarea
                                        value={archMarkdown}
                                        onChange={(e) =>
                                            setArchMarkdown(e.target.value)
                                        }
                                        className="min-h-[180px] font-mono"
                                        placeholder="Write architecture notes in markdown..."
                                    />
                                ) : (
                                    <div className="prose prose-neutral dark:prose-invert bg-muted/50 rounded-lg p-4 min-h-[180px]">
                                        <ReactMarkdown>
                                            {archMarkdown}
                                        </ReactMarkdown>
                                    </div>
                                )}
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold mb-2">
                                    Reference Links
                                </h3>
                                <div className="space-y-2">
                                    {archLinks.length === 0 && (
                                        <div className="text-muted-foreground text-sm">
                                            No links added yet.
                                        </div>
                                    )}
                                    {archLinks.map((link, idx) => (
                                        <div
                                            key={link}
                                            className="flex items-center gap-2"
                                        >
                                            <a
                                                href={link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="truncate underline text-primary"
                                                style={{ maxWidth: 320 }}
                                            >
                                                {link}
                                            </a>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                    handleDeleteLink(idx)
                                                }
                                                aria-label="Delete link"
                                            >
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    ))}
                                    <div className="flex gap-2 mt-2">
                                        <Input
                                            value={newLink}
                                            onChange={(e) =>
                                                setNewLink(e.target.value)
                                            }
                                            placeholder="Add new link..."
                                            className="flex-1"
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    handleAddLink();
                                                }
                                            }}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={handleAddLink}
                                            aria-label="Add link"
                                            disabled={
                                                !newLink.trim() ||
                                                archLinks.includes(
                                                    newLink.trim()
                                                )
                                            }
                                        >
                                            <Plus className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>
                    <TabsContent
                        value="tasks"
                        className="mt-4 flex-1 overflow-hidden"
                    >
                        <div className="space-y-6">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-lg font-semibold">
                                    Feature Tasks
                                </h3>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="flex items-center gap-2"
                                    onClick={handleGenerateTasks}
                                >
                                    <Sparkles className="w-4 h-4 mr-1" />
                                    Generate Tasks
                                </Button>
                            </div>
                            <div className="flex gap-2 mb-2">
                                <Input
                                    value={taskTitle}
                                    onChange={(e) =>
                                        setTaskTitle(e.target.value)
                                    }
                                    placeholder="Task title"
                                    className="flex-1"
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleAddTask();
                                        }
                                    }}
                                />
                                <Button
                                    type="button"
                                    variant="default"
                                    onClick={handleAddTask}
                                    disabled={!taskTitle.trim()}
                                >
                                    <Plus className="w-4 h-4 mr-1" />
                                    Add
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {tasks.length === 0 ? (
                                    <div className="text-muted-foreground text-sm">
                                        No tasks added yet.
                                    </div>
                                ) : (
                                    tasks.map((task, idx) => (
                                        <div
                                            key={idx}
                                            className="bg-muted/50 rounded-lg p-3 flex items-center justify-between gap-4"
                                        >
                                            <div className="font-semibold text-base truncate">
                                                {task.title}
                                            </div>
                                            <div className="flex gap-2">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() =>
                                                        handleOpenTask(idx)
                                                    }
                                                    aria-label="Open task"
                                                >
                                                    <FileText className="w-4 h-4" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() =>
                                                        handleDeleteTask(idx)
                                                    }
                                                    aria-label="Delete task"
                                                >
                                                    <X className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                            <Dialog
                                open={openTaskIdx !== null}
                                onOpenChange={handleCloseModal}
                            >
                                <DialogContent className="max-w-lg">
                                    <DialogHeader>
                                        <DialogTitle>
                                            {openTaskIdx !== null
                                                ? tasks[openTaskIdx].title
                                                : ""}
                                        </DialogTitle>
                                    </DialogHeader>
                                    <div className="mb-4">
                                        <ShadcnTabs
                                            value={modalTab}
                                            onValueChange={setModalTab}
                                            className="w-full"
                                        >
                                            <ShadcnTabsList className="w-full grid grid-cols-2 mb-2">
                                                <ShadcnTabsTrigger value="write">
                                                    Write
                                                </ShadcnTabsTrigger>
                                                <ShadcnTabsTrigger value="preview">
                                                    Preview
                                                </ShadcnTabsTrigger>
                                            </ShadcnTabsList>
                                            <ShadcnTabsContent value="write">
                                                <Textarea
                                                    value={modalContent}
                                                    onChange={(e) =>
                                                        setModalContent(
                                                            e.target.value
                                                        )
                                                    }
                                                    className="min-h-[180px] font-mono"
                                                    placeholder="Write task details in markdown..."
                                                />
                                            </ShadcnTabsContent>
                                            <ShadcnTabsContent value="preview">
                                                <div className="prose prose-neutral dark:prose-invert bg-muted/50 rounded-lg p-3 min-h-[180px]">
                                                    <ReactMarkdown>
                                                        {modalContent ||
                                                            "_No content yet_"}
                                                    </ReactMarkdown>
                                                </div>
                                            </ShadcnTabsContent>
                                        </ShadcnTabs>
                                    </div>
                                    <DialogFooter>
                                        <Button
                                            variant="outline"
                                            onClick={handleCloseModal}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            variant="default"
                                            onClick={handleSaveModal}
                                        >
                                            Save
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
