"use client";

import { useState, useEffect } from "react";
import { Loader2, Plus, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { TicketsTable } from "@/components/features/TicketsTable";
import type { PhaseListItem, TicketListItem, UpdateTicketRequest } from "@/types/roadmap";
import type { TicketStatus } from "@prisma/client";

interface PhasesAndTicketsSectionProps {
  featureId: string;
  workspaceSlug: string;
  phases: (PhaseListItem & { tickets: TicketListItem[] })[];
  unassignedTickets: TicketListItem[];
  onUpdate: () => void;
}

export function PhasesAndTicketsSection({
  featureId,
  workspaceSlug,
  phases: initialPhases,
  unassignedTickets: initialUnassignedTickets,
  onUpdate,
}: PhasesAndTicketsSectionProps) {
  const [phases, setPhases] = useState(initialPhases);
  const [unassignedTickets, setUnassignedTickets] = useState(initialUnassignedTickets);
  const [activeTab, setActiveTab] = useState("unassigned");
  const [newPhaseName, setNewPhaseName] = useState("");
  const [creatingPhase, setCreatingPhase] = useState(false);
  const [showAddPhaseDialog, setShowAddPhaseDialog] = useState(false);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState("");
  const [deletePhaseId, setDeletePhaseId] = useState<string | null>(null);
  const [deletingPhase, setDeletingPhase] = useState(false);

  // Update local state when props change
  useEffect(() => {
    setPhases(initialPhases);
  }, [initialPhases]);

  useEffect(() => {
    setUnassignedTickets(initialUnassignedTickets);
  }, [initialUnassignedTickets]);

  // Phase operations
  const handleCreatePhase = async () => {
    if (!newPhaseName.trim()) return;

    try {
      setCreatingPhase(true);
      const response = await fetch(`/api/features/${featureId}/phases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newPhaseName.trim() }),
      });

      if (!response.ok) throw new Error("Failed to create phase");

      const result = await response.json();
      if (result.success) {
        const newPhase = { ...result.data, tickets: [] };
        setPhases([...phases, newPhase]);
        setNewPhaseName("");
        setShowAddPhaseDialog(false);
        setActiveTab(newPhase.id);
      }
    } catch (error) {
      console.error("Failed to create phase:", error);
    } finally {
      setCreatingPhase(false);
    }
  };

  const handleUpdatePhase = async (phaseId: string, name: string) => {
    if (!name.trim()) return;

    try {
      const response = await fetch(`/api/phases/${phaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!response.ok) throw new Error("Failed to update phase");

      const result = await response.json();
      if (result.success) {
        setPhases(phases.map((p) => p.id === phaseId ? { ...p, name: name.trim() } : p));
        setEditingPhaseId(null);
      }
    } catch (error) {
      console.error("Failed to update phase:", error);
    }
  };

  const handleDeletePhase = async () => {
    if (!deletePhaseId || deletingPhase) return;

    try {
      setDeletingPhase(true);
      const response = await fetch(`/api/phases/${deletePhaseId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete phase");

      // Switch to unassigned tab and refresh from server
      setActiveTab("unassigned");
      setDeletePhaseId(null);
      onUpdate();
    } catch (error) {
      console.error("Failed to delete phase:", error);
    } finally {
      setDeletingPhase(false);
    }
  };

  // Ticket operations
  const handleCreateTicket = async (data: { title: string; status: TicketStatus; phaseId?: string | null; assigneeId?: string | null }) => {
    const phaseId = activeTab === "unassigned" ? (data.phaseId ?? null) : activeTab;

    try {
      const response = await fetch(`/api/features/${featureId}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: data.title, status: data.status, phaseId, assigneeId: data.assigneeId }),
      });

      if (!response.ok) throw new Error("Failed to create ticket");

      const result = await response.json();
      if (result.success) {
        if (phaseId) {
          setPhases(phases.map((p) =>
            p.id === phaseId
              ? { ...p, tickets: [...p.tickets, result.data] }
              : p
          ));
        } else {
          setUnassignedTickets([...unassignedTickets, result.data]);
        }
      }
    } catch (error) {
      console.error("Failed to create ticket:", error);
      throw error;
    }
  };

  const handleUpdateTicket = async (ticketId: string, updates: UpdateTicketRequest) => {
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error("Failed to update ticket");

      // Refresh from server to get updated data
      onUpdate();
    } catch (error) {
      console.error("Failed to update ticket:", error);
    }
  };

  const handleDeleteTicket = async (ticketId: string) => {
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete ticket");

      // Refresh from server - let API be single source of truth
      onUpdate();
    } catch (error) {
      console.error("Failed to delete ticket:", error);
    }
  };

  const handleReorderTickets = async (tickets: TicketListItem[]) => {
    try {
      const response = await fetch(`/api/tickets/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickets: tickets.map((ticket, index) => ({
            id: ticket.id,
            order: index,
            phaseId: ticket.phaseId,
          })),
        }),
      });

      if (!response.ok) throw new Error("Failed to reorder tickets");

      // Update local state
      if (activeTab === "unassigned") {
        setUnassignedTickets(tickets);
      } else {
        setPhases(phases.map((p) =>
          p.id === activeTab ? { ...p, tickets } : p
        ));
      }
    } catch (error) {
      console.error("Failed to reorder tickets:", error);
      onUpdate();
    }
  };

  const phaseToDelete = phases.find((p) => p.id === deletePhaseId);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <div className="flex items-center justify-between mb-4">
        <TabsList className="**:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:px-1">
          <TabsTrigger value="unassigned">
            Unassigned
            {unassignedTickets.length > 0 && (
              <Badge variant="secondary">{unassignedTickets.length}</Badge>
            )}
          </TabsTrigger>
          {phases.map((phase) => (
            <TabsTrigger key={phase.id} value={phase.id} className="group relative">
              {editingPhaseId === phase.id ? (
                <Input
                  value={editingPhaseName}
                  onChange={(e) => setEditingPhaseName(e.target.value)}
                  onBlur={() => {
                    handleUpdatePhase(phase.id, editingPhaseName);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleUpdatePhase(phase.id, editingPhaseName);
                    } else if (e.key === "Escape") {
                      setEditingPhaseId(null);
                    }
                  }}
                  className="h-6 w-32 text-sm"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  {phase.name}
                  {phase.tickets.length > 0 && (
                    <Badge variant="secondary">{phase.tickets.length}</Badge>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <div
                        className="ml-1 size-4 opacity-0 group-hover:opacity-100 inline-flex items-center justify-center cursor-pointer hover:bg-accent rounded-sm transition-colors"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.currentTarget.click();
                          }
                        }}
                      >
                        <Edit2 className="size-3" />
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditingPhaseId(phase.id);
                          setEditingPhaseName(phase.name);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeletePhaseId(phase.id)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <Dialog open={showAddPhaseDialog} onOpenChange={setShowAddPhaseDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Phase
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Phase</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phase-name">Phase Name</Label>
                <Input
                  id="phase-name"
                  placeholder="e.g., Data Model & Backend"
                  value={newPhaseName}
                  onChange={(e) => setNewPhaseName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !creatingPhase) {
                      handleCreatePhase();
                    }
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowAddPhaseDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreatePhase}
                disabled={creatingPhase || !newPhaseName.trim()}
              >
                {creatingPhase ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Phase"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Unassigned Tab */}
      <TabsContent value="unassigned" className="mt-0">
        <TicketsTable
          tickets={unassignedTickets}
          workspaceSlug={workspaceSlug}
          onReorder={handleReorderTickets}
          onUpdate={handleUpdateTicket}
          onDelete={handleDeleteTicket}
          onCreate={handleCreateTicket}
        />
      </TabsContent>

      {/* Phase Tabs */}
      {phases.map((phase) => (
        <TabsContent key={phase.id} value={phase.id} className="mt-0">
          <TicketsTable
            tickets={phase.tickets}
            workspaceSlug={workspaceSlug}
            onReorder={handleReorderTickets}
            onUpdate={handleUpdateTicket}
            onDelete={handleDeleteTicket}
            onCreate={handleCreateTicket}
          />
        </TabsContent>
      ))}

      {/* Delete Phase Confirmation Modal */}
      <AlertDialog open={!!deletePhaseId} onOpenChange={() => setDeletePhaseId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Phase</AlertDialogTitle>
            <AlertDialogDescription>
              {phaseToDelete && phaseToDelete.tickets.length > 0 ? (
                <>
                  Are you sure you want to delete this phase? {phaseToDelete.tickets.length} ticket(s) will be moved to unassigned.
                </>
              ) : (
                "Are you sure you want to delete this phase? This action cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPhase}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePhase}
              disabled={deletingPhase}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingPhase ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
