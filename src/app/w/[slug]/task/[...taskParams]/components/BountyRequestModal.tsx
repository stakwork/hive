"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HelpCircle, Loader2, ExternalLink, CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useBtcPrice, satsToUsd, formatSats, formatUsd } from "@/hooks/useBtcPrice";
import BitcoinIcon from "@/components/Icons/BitcoinIcon";
import { cn } from "@/lib/utils";

interface BountyRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceTaskId: string;
  sourceWorkspaceSlug: string;
  sourceWorkspaceId: string;
  sourceTaskTitle: string;
  sourceTaskDescription?: string | null;
}

export function BountyRequestModal({
  isOpen,
  onClose,
  sourceTaskId,
  sourceWorkspaceSlug,
  sourceWorkspaceId,
  sourceTaskTitle,
  sourceTaskDescription,
}: BountyRequestModalProps) {
  const [title, setTitle] = useState(sourceTaskTitle);
  const [description, setDescription] = useState(sourceTaskDescription || "");
  const [estimatedHours, setEstimatedHours] = useState<number | undefined>(undefined);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [priceSats, setPriceSats] = useState<number | undefined>(undefined);
  const [staking, setStaking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { priceUsd: btcPriceUsd } = useBtcPrice();

  // Calculate USD from sats price
  const priceUsd = priceSats ? satsToUsd(priceSats, btcPriceUsd) : null;

  // Update title when source task title changes
  useEffect(() => {
    setTitle(sourceTaskTitle);
  }, [sourceTaskTitle]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle(sourceTaskTitle);
      setDescription(sourceTaskDescription || "");
      setEstimatedHours(undefined);
      setDueDate(undefined);
      setPriceSats(undefined);
      setStaking(false);
    }
  }, [isOpen, sourceTaskTitle, sourceTaskDescription]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/bounty-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          sourceTaskId,
          sourceWorkspaceSlug,
          sourceWorkspaceId,
          estimatedHours,
          dueDate: dueDate?.toISOString(),
          priceUsd: priceUsd ? Math.round(priceUsd * 100) : undefined, // Convert to cents
          priceSats: priceSats ?? undefined,
          staking,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create bounty request");
      }

      await response.json();

      onClose();

      toast.success("Bounty workspace is being generated. You'll see it here when ready.");
    } catch (error) {
      console.error("Error creating bounty request:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create bounty request");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5" />
            Need Help?
          </DialogTitle>
          <DialogDescription>
            Create a bounty request for human assistance
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4 max-h-[60vh] overflow-y-auto -mr-6 pr-6">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="bounty-title" className="text-sm font-medium">
              Title
            </Label>
            <Input
              id="bounty-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of what you need help with"
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="bounty-description" className="text-sm font-medium">
              Description
            </Label>
            <Textarea
              id="bounty-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide more details about the help you need..."
              className="min-h-[100px] resize-none"
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              Describe the problem, expected outcome, and any relevant context
            </p>
          </div>

          {/* Estimated Time */}
          <div className="space-y-2">
            <Label htmlFor="bounty-hours" className="text-sm font-medium">
              Estimated Time (hours)
            </Label>
            <div className="flex gap-2 items-center">
              <Input
                id="bounty-hours"
                type="text"
                inputMode="decimal"
                value={estimatedHours ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setEstimatedHours(val ? parseFloat(val) || undefined : undefined);
                }}
                placeholder="0"
                className="w-20 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                disabled={isSubmitting}
              />
              <div className="flex gap-1">
                {[1, 2, 4, 8].map((hours) => (
                  <Button
                    key={hours}
                    type="button"
                    variant={estimatedHours === hours ? "default" : "outline"}
                    size="sm"
                    onClick={() => setEstimatedHours(hours)}
                    disabled={isSubmitting}
                  >
                    {hours}h
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Due Date */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Due Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !dueDate && "text-muted-foreground"
                  )}
                  disabled={isSubmitting}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? format(dueDate, "PPP") : "Select a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={dueDate}
                  onSelect={setDueDate}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Price (Sats) */}
          <div className="space-y-2">
            <Label htmlFor="bounty-price" className="text-sm font-medium">
              Price (sats)
            </Label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                  <BitcoinIcon className="h-4 w-4 text-muted-foreground" />
                </div>
                <Input
                  id="bounty-price"
                  type="text"
                  inputMode="numeric"
                  value={priceSats ? formatSats(priceSats) : ""}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, "");
                    setPriceSats(raw ? parseInt(raw, 10) || undefined : undefined);
                  }}
                  placeholder="0"
                  className="pl-9 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  disabled={isSubmitting}
                />
              </div>
              <span className="text-sm text-muted-foreground shrink-0">sats</span>
            </div>
            {priceSats && priceUsd !== null && (
              <p className="text-xs text-muted-foreground">
                {formatUsd(priceUsd)} USD
              </p>
            )}
          </div>

          {/* Staking Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="bounty-staking" className="text-sm font-medium">
                Require Staking
              </Label>
              <p className="text-xs text-muted-foreground">
                Bounty hunters must stake to claim this bounty
              </p>
            </div>
            <Switch
              id="bounty-staking"
              checked={staking}
              onCheckedChange={setStaking}
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !title.trim()}>
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <ExternalLink className="w-4 h-4 mr-2" />
                Create Bounty
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
