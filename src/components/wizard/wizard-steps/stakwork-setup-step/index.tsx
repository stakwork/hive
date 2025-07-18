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
import { CheckCircle } from "lucide-react";

interface StakworkSetupStepProps {
    workspaceName: string;
    onFinish: () => void;
    onBack: () => void;
    stepStatus?: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";
}

export function StakworkSetupStep({
    workspaceName,
    onFinish,
    onBack,
}: StakworkSetupStepProps) {
    return (
        <Card className="max-w-2xl mx-auto">
            <CardHeader className="text-center">
                <div className="flex items-center justify-center mx-auto mb-4">
                    {/* Animated Chain SVG for workflows - teal/emerald */}
                    <svg
                        width="96"
                        height="40"
                        viewBox="0 0 96 40"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        {/* Chain links */}
                        <circle cx="16" cy="20" r="7" fill="#10B981">
                            <animate
                                attributeName="r"
                                values="7;9;7"
                                dur="2.4s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="40" cy="20" r="7" fill="#34D399">
                            <animate
                                attributeName="r"
                                values="7;9;7"
                                dur="2.4s"
                                begin="0.3s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="64" cy="20" r="7" fill="#10B981">
                            <animate
                                attributeName="r"
                                values="7;9;7"
                                dur="2.4s"
                                begin="0.6s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        <circle cx="88" cy="20" r="7" fill="#34D399">
                            <animate
                                attributeName="r"
                                values="7;9;7"
                                dur="2.4s"
                                begin="0.9s"
                                repeatCount="indefinite"
                            />
                        </circle>
                        {/* Animated connecting lines */}
                        <line
                            x1="23"
                            y1="20"
                            x2="33"
                            y2="20"
                            stroke="#06B6D4"
                            strokeWidth="4"
                        >
                            <animate
                                attributeName="stroke"
                                values="#06B6D4;#10B981;#06B6D4"
                                dur="2.4s"
                                repeatCount="indefinite"
                            />
                        </line>
                        <line
                            x1="47"
                            y1="20"
                            x2="57"
                            y2="20"
                            stroke="#06B6D4"
                            strokeWidth="4"
                        >
                            <animate
                                attributeName="stroke"
                                values="#06B6D4;#10B981;#06B6D4"
                                dur="2.4s"
                                begin="0.3s"
                                repeatCount="indefinite"
                            />
                        </line>
                        <line
                            x1="71"
                            y1="20"
                            x2="81"
                            y2="20"
                            stroke="#06B6D4"
                            strokeWidth="4"
                        >
                            <animate
                                attributeName="stroke"
                                values="#06B6D4;#10B981;#06B6D4"
                                dur="2.4s"
                                begin="0.6s"
                                repeatCount="indefinite"
                            />
                        </line>
                    </svg>
                </div>
                <CardTitle className="text-2xl">
                    Creating Stakwork Account
                </CardTitle>
                <CardDescription>
                    Stakwork powers the automation engine for your workflows.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <Label
                        htmlFor="stakworkName"
                        className="text-sm font-medium text-gray-700"
                    >
                        Stakwork Customer
                    </Label>
                    <Input
                        id="stakworkName"
                        value={workspaceName}
                        readOnly
                        className="mt-2 bg-gray-100 cursor-not-allowed"
                    />
                </div>
                <div className="flex justify-between pt-4">
                    <Button variant="outline" type="button" onClick={onBack}>
                        Back
                    </Button>
                    <Button
                        className="px-8 bg-green-600 hover:bg-green-700"
                        type="button"
                        onClick={onFinish}
                    >
                        Finish
                        <CheckCircle className="w-4 h-4 ml-2" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
