// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaidEndpoint {
  id: number;
  endpoint: string;
  route_description: string;
  status: boolean;
  price: number;
}

export interface BoltwallUser {
  id?: number;
  pubkey: string | null;
  name: string | null;
  role: "owner" | "admin" | "sub_admin" | "member";
  hive?: { name: string | null; image: string | null } | null;
}

export interface GraphAdminClientProps {
  swarmUrl: string | null;
  workspaceSlug: string;
}

export interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: BoltwallUser;
  onSave: (data: { pubkey: string; name: string; role: string }) => Promise<void>;
}

export interface SetOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: { pubkey: string; name: string }) => Promise<void>;
}
