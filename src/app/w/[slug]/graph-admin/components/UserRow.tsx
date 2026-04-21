import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import type { BoltwallUser } from "../types";
import { getRoleLabel, getInitials } from "../utils";

export function UserRow({
  user,
  onEdit,
  onDelete,
  onSetOwner,
}: {
  user: BoltwallUser;
  onEdit: () => void;
  onDelete: () => void;
  onSetOwner: () => void;
}) {
  const isOwner = user.role === "owner";
  const displayName = user.name ?? (user.pubkey ? `${user.pubkey.slice(0, 16)}…` : "—");

  return (
    <tr className="border-b last:border-0">
      {/* User cell */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7 text-xs">
            <AvatarFallback>{getInitials(user.name, user.pubkey)}</AvatarFallback>
          </Avatar>
          <span className="font-mono text-xs text-muted-foreground">{displayName}</span>
        </div>
      </td>
      {/* Role cell */}
      <td className="px-4 py-3">
        <Badge variant={isOwner ? "secondary" : "outline"}>{getRoleLabel(user.role)}</Badge>
      </td>
      {/* Actions cell */}
      <td className="px-4 py-3 text-right">
        {isOwner && user.pubkey === null ? (
          <Button size="sm" variant="outline" onClick={onSetOwner}>
            Set Owner
          </Button>
        ) : isOwner ? null : (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit user">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete user">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
