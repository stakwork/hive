"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Laptop, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatRelativeOrDateInTz } from "@/lib/date-utils";
import { useUserTimezone } from "@/hooks/useUserTimezone";

interface StrutDeviceItem {
  id: string;
  name: string;
  credentialPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The person's paired strut devices (`/api/strut-devices`), each revocable. */
export function StrutDevicesSettings() {
  const { timezone } = useUserTimezone();
  const [devices, setDevices] = useState<StrutDeviceItem[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/strut-devices");
      if (!res.ok) throw new Error();
      setDevices(((await res.json()) as { devices: StrutDeviceItem[] }).devices);
    } catch {
      setDevices([]);
      toast.error("Failed to load devices");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      const res = await fetch(`/api/strut-devices/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setDevices((list) => list?.filter((d) => d.id !== id) ?? null);
      toast.success("Device revoked");
    } catch {
      toast.error("Failed to revoke device");
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Laptop className="h-5 w-5" />
          Strut Devices
        </CardTitle>
        <CardDescription>
          Desktop apps paired to your account. Each holds a token for each of your orgs&apos; strut and renews it
          daily; revoking a device stops the renewal, and its tokens expire within a week.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {devices === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices paired. Pair one from the strut desktop app.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Paired</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell className="font-medium">
                    {device.name}
                    <div>
                      <code className="text-xs text-muted-foreground">{device.credentialPrefix}...</code>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeOrDateInTz(device.createdAt, timezone)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {device.lastUsedAt ? formatRelativeOrDateInTz(device.lastUsedAt, timezone) : "Never"}
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={revoking === device.id}
                          aria-label={`Revoke ${device.name}`}
                        >
                          {revoking === device.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke device</AlertDialogTitle>
                          <AlertDialogDescription>
                            &quot;{device.name}&quot; will no longer renew its access to your orgs&apos; strut. The
                            tokens it already holds stop working within a week.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => revoke(device.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Revoke
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
