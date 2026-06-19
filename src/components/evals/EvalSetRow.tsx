import { Pencil, Trash2 } from "lucide-react";
import { TableRow, TableCell } from "@/components/ui/table";
import { ActionMenu } from "@/components/ui/action-menu";
import type { JarvisNode } from "@/types/jarvis";

interface EvalSetRowProps {
  evalSet: JarvisNode;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function EvalSetRow({ evalSet, onClick, onEdit, onDelete }: EvalSetRowProps) {
  const name = String(evalSet.properties?.name ?? "Unnamed Eval Set");
  const description = evalSet.properties?.description
    ? String(evalSet.properties.description)
    : null;

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50 transition-colors"
      onClick={onClick}
      data-testid="eval-set-row"
    >
      <TableCell className="w-[220px] font-medium truncate">{name}</TableCell>
      <TableCell className="text-sm text-muted-foreground truncate">
        {description ?? "—"}
      </TableCell>
      <TableCell className="w-[50px]" onClick={(e) => e.stopPropagation()}>
        <ActionMenu
          actions={[
            {
              label: "Edit",
              icon: Pencil,
              onClick: onEdit,
            },
            {
              label: "Delete",
              icon: Trash2,
              variant: "destructive",
              confirmation: {
                title: "Delete eval set?",
                description: "This will remove the eval set. Requirements will not be deleted.",
                confirmText: "Delete",
                onConfirm: onDelete,
              },
            },
          ]}
        />
      </TableCell>
    </TableRow>
  );
}
