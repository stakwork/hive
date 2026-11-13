/**
 * Information about a collaborator currently present (plan chat, task chat, etc.)
 */
export interface CollaboratorInfo {
  odinguserId: string;
  name: string;
  image: string | null;
  color: string;
  joinedAt: number;
}
