"use client";

import { useState } from "react";
import { MoreVertical, LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ActionMenuItem {
  label: string;
  icon?: LucideIcon;
  variant?: "default" | "destructive";
  onClick?: () => void | Promise<void>;
  confirmation?: {
    title: string;
    description: string;
    onConfirm: () => void | Promise<void>;
    confirmText?: string;
    cancelText?: string;
  };
  separator?: boolean; // Add separator after this item
}

interface ActionMenuProps {
  actions: ActionMenuItem[];
  align?: "start" | "end" | "center";
  triggerClassName?: string;
  triggerVariant?: "ghost" | "outline" | "default";
  triggerSize?: "sm" | "default" | "lg" | "icon";
}

export function ActionMenu({
  actions,
  align = "end",
  triggerClassName = "h-7 w-7 p-0 text-muted-foreground",
  triggerVariant = "ghost",
  triggerSize = "sm",
}: ActionMenuProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [confirmationStates, setConfirmationStates] = useState<Record<number, boolean>>({});

  const closeMenu = () => setIsMenuOpen(false);

  const handleActionClick = async (action: ActionMenuItem, index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    closeMenu();

    if (action.confirmation) {
      setConfirmationStates((prev) => ({ ...prev, [index]: true }));
    } else if (action.onClick) {
      await action.onClick();
    }
  };

  const handleConfirm = async (action: ActionMenuItem, index: number) => {
    if (action.confirmation) {
      setConfirmationStates((prev) => ({ ...prev, [index]: false }));
      await action.confirmation.onConfirm();
    }
  };

  const handleCancel = (index: number) => {
    setConfirmationStates((prev) => ({ ...prev, [index]: false }));
  };

  return (
    <>
      <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={triggerVariant}
            size={triggerSize}
            className={triggerClassName}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">More actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <div key={index}>
                <DropdownMenuItem variant={action.variant} onClick={(e) => handleActionClick(action, index, e)}>
                  {Icon && <Icon className="h-4 w-4" />}
                  {action.label}
                </DropdownMenuItem>
                {action.separator && index < actions.length - 1 && <DropdownMenuSeparator />}
              </div>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Render confirmation dialogs for actions that need them */}
      {actions.map((action, index) =>
        action.confirmation ? (
          <AlertDialog
            key={index}
            open={confirmationStates[index] || false}
            onOpenChange={(open) => {
              if (!open) handleCancel(index);
            }}
          >
            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle>{action.confirmation.title}</AlertDialogTitle>
                <AlertDialogDescription>{action.confirmation.description}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => handleCancel(index)}>
                  {action.confirmation.cancelText || "Cancel"}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleConfirm(action, index)}
                  className={
                    action.variant === "destructive"
                      ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      : ""
                  }
                >
                  {action.confirmation.confirmText || action.label}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null,
      )}
    </>
  );
}
