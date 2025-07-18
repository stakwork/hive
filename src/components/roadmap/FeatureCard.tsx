import React from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, FileText, Clock } from "lucide-react";
import { Feature } from "./RoadmapContent";

interface FeatureCardProps {
    feature: Feature;
    onEdit: () => void;
    getStatusColor: (status: Feature["status"]) => string;
    getPriorityColor: (priority: Feature["priority"]) => string;
}

export function FeatureCard({
    feature,
    onEdit,
    getStatusColor,
    getPriorityColor,
}: FeatureCardProps) {
    return (
        <Card
            className="hover:shadow-md transition-shadow cursor-pointer group"
            onClick={onEdit}
        >
            <CardHeader className="pb-4">
                <div className="flex justify-between items-start">
                    <div className="flex-1">
                        <CardTitle className="text-lg group-hover:text-primary transition-colors">
                            {feature.title}
                        </CardTitle>
                        <CardDescription className="mt-2 line-clamp-2">
                            {feature.brief}
                        </CardDescription>
                    </div>
                    {/* Remove the edit button */}
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                <div className="space-y-4">
                    {/* Status and Priority Badges */}
                    <div className="flex gap-2 flex-wrap">
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
                    {/* Stats */}
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1">
                                <Users className="w-4 h-4" />
                                <span>{feature.userStories.length}</span>
                                <span className="text-xs">stories</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <FileText className="w-4 h-4" />
                                <span>{feature.requirements.length}</span>
                                <span className="text-xs">reqs</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span className="text-xs">
                                {new Date(
                                    feature.updatedAt
                                ).toLocaleDateString()}
                            </span>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
