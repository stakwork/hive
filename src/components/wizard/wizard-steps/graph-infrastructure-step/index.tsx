// No hooks needed
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface GraphInfrastructureStepProps {
    swarmName: string;
    graphDomain: string;
    status: "idle" | "pending" | "complete";
    onCreate: () => Promise<void>;
    onComplete: () => void;
    onBack: () => void;
    stepStatus?: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";
    onStatusChange?: (
        status: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED"
    ) => void;
}

export function GraphInfrastructureStep({
    swarmName,
    graphDomain,
    status,
    onCreate,
    onComplete,
    onBack,
    onStatusChange,
}: GraphInfrastructureStepProps) {
    const isPending = status === "pending";
    const isComplete = status === "complete";

    const handleCreate = async () => {
        onStatusChange?.("PROCESSING");
        try {
            await onCreate();
            onStatusChange?.("COMPLETED");
        } catch (error) {
            onStatusChange?.("FAILED");
            throw error;
        }
    };

    const handleComplete = () => {
        onStatusChange?.("COMPLETED");
        onComplete();
    };
    return (
        <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
            <CardHeader className="text-center">
                <div className="flex items-center justify-center mx-auto mb-4">
                    {/* Animated Knowledge Graph SVG */}
                    <svg
                        width="64"
                        height="64"
                        viewBox="0 0 64 64"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        {/* Edges */}
                        <line
                            x1="32"
                            y1="12"
                            x2="12"
                            y2="32"
                            stroke="#60A5FA"
                            strokeWidth="2"
                        />
                        <line
                            x1="32"
                            y1="12"
                            x2="52"
                            y2="32"
                            stroke="#60A5FA"
                            strokeWidth="2"
                        />
                        <line
                            x1="12"
                            y1="32"
                            x2="32"
                            y2="52"
                            stroke="#60A5FA"
                            strokeWidth="2"
                        />
                        <line
                            x1="52"
                            y1="32"
                            x2="32"
                            y2="52"
                            stroke="#60A5FA"
                            strokeWidth="2"
                        />
                        {/* Nodes with animation */}
                        <circle cx="32" cy="12" r="6" fill="#2563EB">
                            <animate
                                attributeName="r"
                                values="6;8;6"
                                dur="1.2s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="12" cy="32" r="5" fill="#3B82F6">
                            <animate
                                attributeName="r"
                                values="5;7;5"
                                dur="1.2s"
                                begin="0.3s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="52" cy="32" r="5" fill="#3B82F6">
                            <animate
                                attributeName="r"
                                values="5;7;5"
                                dur="1.2s"
                                begin="0.6s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="32" cy="52" r="5" fill="#60A5FA">
                            <animate
                                attributeName="r"
                                values="5;7;5"
                                dur="1.2s"
                                begin="0.9s"
                                repeatCount="indefinite"
                            />
                        </circle>
                    </svg>
                </div>
                <AnimatePresence mode="wait">
                    {!isPending ? (
                        <motion.div
                            key="title-creating"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.3 }}
                        >
                            <CardTitle className="text-2xl">
                                Creating Graph Infrastructure
                            </CardTitle>
                            <CardDescription>
                                Your graph infrastructure domain will be:
                            </CardDescription>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="title-swarm"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.3 }}
                        >
                            <CardTitle className="text-2xl">
                                Setting up Swarm
                            </CardTitle>
                            <CardDescription>
                                Your swarm is being set up. This may take a few
                                minutes.
                            </CardDescription>
                        </motion.div>
                    )}
                </AnimatePresence>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <Label
                        htmlFor="graphDomain"
                        className="text-sm font-medium text-foreground"
                    >
                        Graph Domain
                    </Label>
                    <Input
                        id="graphDomain"
                        value={swarmName || `${graphDomain}.sphinx.chat`}
                        readOnly
                        tabIndex={-1}
                        className="mt-2 bg-muted cursor-not-allowed select-all focus:outline-none focus:ring-0 hover:bg-muted"
                        style={{ pointerEvents: "none" }}
                    />
                </div>
                <div className="flex justify-between pt-4">
                    {!isPending && (
                        <Button
                            variant="outline"
                            type="button"
                            onClick={onBack}
                        >
                            Back
                        </Button>
                    )}
                    {status === "idle" && (
                        <Button
                            className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
                            type="button"
                            onClick={handleCreate}
                        >
                            Create
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                    )}
                    {isPending && (
                        <div className="flex flex-col items-end gap-2 w-full">
                            <Button
                                className={`mt-2 ml-auto px-8 bg-muted text-muted-foreground`}
                                type="button"
                                disabled
                            >
                                Generating Swarm...
                            </Button>
                            {isComplete && (
                                <Button
                                    className="mt-2 ml-auto px-8 bg-primary text-primary-foreground hover:bg-primary/90"
                                    type="button"
                                    onClick={handleComplete}
                                >
                                    Continue
                                </Button>
                            )}
                        </div>
                    )}
                    {isComplete && !isPending && (
                        <Button
                            className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
                            type="button"
                            onClick={handleComplete}
                        >
                            Continue
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
