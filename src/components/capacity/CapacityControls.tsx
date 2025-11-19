import { Button } from "@/components/ui/button";
import { LayoutGrid, Server } from "lucide-react";

interface CapacityControlsProps {
    viewMode: '2d' | '3d';
    onViewModeChange: (mode: '2d' | '3d') => void;
}

export function CapacityControls({ viewMode, onViewModeChange }: CapacityControlsProps) {
    return (
        <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Pods</span>
            <div className="inline-flex items-center gap-1 p-1 bg-muted rounded-lg">
                <Button
                    variant={viewMode === '2d' ? 'default' : 'ghost'}
                    size="icon"
                    onClick={() => onViewModeChange('2d')}
                    className="h-8 w-8"
                >
                    <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                    variant={viewMode === '3d' ? 'default' : 'ghost'}
                    size="icon"
                    onClick={() => onViewModeChange('3d')}
                    className="h-8 w-8"
                >
                    <Server className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
