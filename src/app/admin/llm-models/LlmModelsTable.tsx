"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { LlmModel, LlmProvider } from "@prisma/client";

const PROVIDERS: LlmProvider[] = ["GOOGLE", "ANTHROPIC", "OPENAI", "AWS_BEDROCK", "OTHER"];

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  GOOGLE: "Google",
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  AWS_BEDROCK: "AWS Bedrock",
  OTHER: "Other",
};

function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString();
}

function formatPrice(price: number): string {
  return `$${price.toFixed(4)}`;
}

function isActive(dateEnd: Date | string | null): boolean {
  if (!dateEnd) return true;
  return new Date(dateEnd) > new Date();
}

interface FormState {
  name: string;
  provider: LlmProvider;
  providerLabel: string;
  inputPricePer1M: string;
  outputPricePer1M: string;
  dateStart: string;
  dateEnd: string;
  isPlanDefault: boolean;
  isTaskDefault: boolean;
  isPublic: boolean;
}

const emptyForm: FormState = {
  name: "",
  provider: "OPENAI",
  providerLabel: "",
  inputPricePer1M: "",
  outputPricePer1M: "",
  dateStart: "",
  dateEnd: "",
  isPlanDefault: false,
  isTaskDefault: false,
  isPublic: false,
};

function modelToForm(model: LlmModel): FormState {
  return {
    name: model.name,
    provider: model.provider,
    providerLabel: model.providerLabel ?? "",
    inputPricePer1M: String(model.inputPricePer1M),
    outputPricePer1M: String(model.outputPricePer1M),
    dateStart: model.dateStart
      ? new Date(model.dateStart).toISOString().split("T")[0]
      : "",
    dateEnd: model.dateEnd
      ? new Date(model.dateEnd).toISOString().split("T")[0]
      : "",
    isPlanDefault: model.isPlanDefault,
    isTaskDefault: model.isTaskDefault,
    isPublic: model.isPublic,
  };
}

interface LlmModelsTableProps {
  initialData: LlmModel[];
}

export default function LlmModelsTable({ initialData }: LlmModelsTableProps) {
  const [models, setModels] = useState<LlmModel[]>(initialData);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<LlmModel | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditingModel(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (model: LlmModel) => {
    setEditingModel(model);
    setForm(modelToForm(model));
    setDialogOpen(true);
  };

  const refreshModels = async () => {
    try {
      const res = await fetch("/api/admin/llm-models");
      if (res.ok) {
        const data = await res.json();
        setModels(data.models);
      }
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.provider || !form.inputPricePer1M || !form.outputPricePer1M) {
      toast.error("Name, provider, input price, and output price are required.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name,
        provider: form.provider,
        providerLabel: form.provider === "OTHER" ? form.providerLabel : null,
        inputPricePer1M: parseFloat(form.inputPricePer1M),
        outputPricePer1M: parseFloat(form.outputPricePer1M),
        dateStart: form.dateStart || null,
        dateEnd: form.dateEnd || null,
        isPlanDefault: form.isPlanDefault,
        isTaskDefault: form.isTaskDefault,
        isPublic: form.isPublic,
      };

      const url = editingModel
        ? `/api/admin/llm-models/${editingModel.id}`
        : "/api/admin/llm-models";
      const method = editingModel ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      toast.success(editingModel ? "Model updated." : "Model created.");
      setDialogOpen(false);
      await refreshModels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (model: LlmModel) => {
    if (!window.confirm(`Delete "${model.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/admin/llm-models/${model.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      toast.success("Model deleted.");
      await refreshModels();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={openAdd}>Add Model</Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-3 pr-4 font-medium">Name</th>
              <th className="pb-3 pr-4 font-medium">Provider</th>
              <th className="pb-3 pr-4 font-medium">Input / 1M</th>
              <th className="pb-3 pr-4 font-medium">Output / 1M</th>
              <th className="pb-3 pr-4 font-medium">Date Start</th>
              <th className="pb-3 pr-4 font-medium">Date End</th>
              <th className="pb-3 pr-4 font-medium">Defaults</th>
              <th className="pb-3 pr-4 font-medium">Status</th>
              <th className="pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-muted-foreground">
                  No LLM models found. Add one to get started.
                </td>
              </tr>
            )}
            {models.map((model) => (
              <tr key={model.id} className="border-b last:border-0">
                <td className="py-3 pr-4 font-medium">{model.name}</td>
                <td className="py-3 pr-4">
                  {model.provider === "OTHER" && model.providerLabel
                    ? model.providerLabel
                    : PROVIDER_LABELS[model.provider]}
                </td>
                <td className="py-3 pr-4">{formatPrice(model.inputPricePer1M)}</td>
                <td className="py-3 pr-4">{formatPrice(model.outputPricePer1M)}</td>
                <td className="py-3 pr-4">{formatDate(model.dateStart)}</td>
                <td className="py-3 pr-4">{formatDate(model.dateEnd)}</td>
                <td className="py-3 pr-4">
                  <div className="flex gap-1 flex-wrap">
                    {model.isPlanDefault && (
                      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Plan</Badge>
                    )}
                    {model.isTaskDefault && (
                      <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">Task</Badge>
                    )}
                    {model.isPublic && (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Public</Badge>
                    )}
                  </div>
                </td>
                <td className="py-3 pr-4">
                  {isActive(model.dateEnd) ? (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">Inactive</Badge>
                  )}
                </td>
                <td className="py-3">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(model)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(model)}
                      className="text-destructive hover:text-destructive"
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingModel ? "Edit LLM Model" : "Add LLM Model"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="llm-name">Name *</Label>
              <Input
                id="llm-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="gpt-4o"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="llm-provider">Provider *</Label>
              <Select
                value={form.provider}
                onValueChange={(v) => setForm((f) => ({ ...f, provider: v as LlmProvider }))}
              >
                <SelectTrigger id="llm-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.provider === "OTHER" && (
              <div className="space-y-1">
                <Label htmlFor="llm-provider-label">Provider Name</Label>
                <Input
                  id="llm-provider-label"
                  value={form.providerLabel}
                  onChange={(e) => setForm((f) => ({ ...f, providerLabel: e.target.value }))}
                  placeholder="e.g. InternalAI"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="llm-input-price">Input Price / 1M tokens *</Label>
                <Input
                  id="llm-input-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.inputPricePer1M}
                  onChange={(e) => setForm((f) => ({ ...f, inputPricePer1M: e.target.value }))}
                  placeholder="5.00"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="llm-output-price">Output Price / 1M tokens *</Label>
                <Input
                  id="llm-output-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.outputPricePer1M}
                  onChange={(e) => setForm((f) => ({ ...f, outputPricePer1M: e.target.value }))}
                  placeholder="15.00"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="llm-date-start">Date Start</Label>
                <Input
                  id="llm-date-start"
                  type="date"
                  value={form.dateStart}
                  onChange={(e) => setForm((f) => ({ ...f, dateStart: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="llm-date-end">Date End</Label>
                <Input
                  id="llm-date-end"
                  type="date"
                  value={form.dateEnd}
                  onChange={(e) => setForm((f) => ({ ...f, dateEnd: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch
                  id="llm-plan-default"
                  checked={form.isPlanDefault}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, isPlanDefault: checked }))}
                />
                <Label htmlFor="llm-plan-default">Plan default</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="llm-task-default"
                  checked={form.isTaskDefault}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, isTaskDefault: checked }))}
                />
                <Label htmlFor="llm-task-default">Task default</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="llm-is-public"
                  checked={form.isPublic}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, isPublic: checked }))}
                />
                <Label htmlFor="llm-is-public">Public</Label>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
