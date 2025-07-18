import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { EnvironmentVariable } from "@/types/wizard";

interface EnvironmentSetupStepProps {
    envVars: EnvironmentVariable[];
    onEnvChange: (
        index: number,
        field: keyof EnvironmentVariable,
        value: string | boolean
    ) => void;
    onAddEnv: () => void;
    onRemoveEnv: (index: number) => void;
    onNext: () => void;
    onBack: () => void;
    stepStatus?: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";
}

export function EnvironmentSetupStep({
    envVars,
    onEnvChange,
    onAddEnv,
    onRemoveEnv,
    onNext,
    onBack,
}: EnvironmentSetupStepProps) {
    return (
        <Card className="max-w-2xl mx-auto">
            <CardHeader className="text-center">
                <div className="flex items-center justify-center mx-auto mb-4">
                    {/* Animated Lock SVG for sensitive env setup - orange/amber */}
                    <svg
                        width="64"
                        height="64"
                        viewBox="0 0 64 64"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        {/* Lock body */}
                        <rect
                            x="18"
                            y="28"
                            width="28"
                            height="24"
                            rx="6"
                            fill="#F59E42"
                        >
                            {" "}
                            {/* amber-500 */}
                            <animate
                                attributeName="fill"
                                values="#F59E42;#FBBF24;#F59E42"
                                dur="1.2s"
                                repeatCount="indefinite"
                            />
                        </rect>
                        {/* Lock shackle */}
                        <path
                            d="M24 28v-6a8 8 0 0 1 16 0v6"
                            stroke="#FBBF24"
                            strokeWidth="3"
                            fill="none"
                        >
                            {" "}
                            {/* amber-400 */}
                            <animate
                                attributeName="stroke"
                                values="#FBBF24;#F59E42;#FBBF24"
                                dur="1.2s"
                                repeatCount="indefinite"
                            />
                        </path>
                        {/* Keyhole */}
                        <circle cx="32" cy="40" r="3" fill="#fff">
                            <animate
                                attributeName="r"
                                values="3;5;3"
                                dur="1.2s"
                                repeatCount="indefinite"
                            />
                        </circle>
                    </svg>
                </div>
                <CardTitle className="text-2xl">
                    Setting up code environment
                </CardTitle>
                <CardDescription>
                    Add any ENV variables your code environment needs.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    {envVars.map((pair, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                            <Input
                                placeholder="KEY"
                                value={pair.key}
                                onChange={(e) =>
                                    onEnvChange(idx, "key", e.target.value)
                                }
                                className="w-1/3"
                            />
                            <div className="relative w-1/2 flex items-center">
                                <Input
                                    placeholder="VALUE"
                                    type={pair.show ? "text" : "password"}
                                    value={pair.value}
                                    onChange={(e) =>
                                        onEnvChange(
                                            idx,
                                            "value",
                                            e.target.value
                                        )
                                    }
                                    className="pr-10"
                                />
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                                    onClick={() =>
                                        onEnvChange(idx, "show", !pair.show)
                                    }
                                    tabIndex={-1}
                                >
                                    {pair.show ? (
                                        <EyeOff className="w-4 h-4" />
                                    ) : (
                                        <Eye className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => onRemoveEnv(idx)}
                                className="px-2"
                                disabled={envVars.length === 1}
                            >
                                Remove
                            </Button>
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={onAddEnv}
                        className="mt-2"
                    >
                        Add Variable
                    </Button>
                </div>
                <div className="flex justify-between pt-4">
                    <Button variant="outline" type="button" onClick={onBack}>
                        Back
                    </Button>
                    <Button
                        className="px-8 bg-green-600 hover:bg-green-700"
                        type="button"
                        onClick={onNext}
                    >
                        Next
                        <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
