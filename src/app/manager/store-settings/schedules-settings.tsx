"use client";

import { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import { Loader, PlusCircle, Power, PowerOff, Trash2 } from "lucide-react";
import { ScheduleEditDialog } from "./schedule-edit-dialog";
import type { MenuSchedule } from "@/lib/types";

/**
 * Firestore data is untyped; we coerce it to a full MenuSchedule with safe defaults.
 * This avoids `as MenuSchedule` on partial objects (which can break builds).
 */
function coerceMenuSchedule(d: QueryDocumentSnapshot<DocumentData>): MenuSchedule {
  const data = d.data() ?? {};

  return {
    id: d.id,
    name: typeof data.name === "string" ? data.name : "",
    startTime: typeof data.startTime === "string" ? data.startTime : "00:00",
    endTime: typeof data.endTime === "string" ? data.endTime : "23:59",
    days: Array.isArray(data.days) ? data.days : [],
    isActive: typeof data.isActive === "boolean" ? data.isActive : true,

    // keep these if your MenuSchedule type expects them
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
  } as MenuSchedule;
}

export function SchedulesSettings() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [schedules, setSchedules] = useState<MenuSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<MenuSchedule | null>(null);

  useEffect(() => {
    if (!activeStore) {
      setSchedules([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const schedulesRef = collection(db, "stores", activeStore.id, "menuSchedules");
    const q = query(schedulesRef, orderBy("name", "asc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(coerceMenuSchedule);
        setSchedules(data);
        setIsLoading(false);
      },
      (error) => {
        console.error("Failed to fetch schedules:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Could not fetch schedules.",
        });
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeStore, toast]);

  const handleOpenDialog = (schedule: MenuSchedule | null = null) => {
    setEditingSchedule(schedule);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setEditingSchedule(null);
    setIsDialogOpen(false);
  };

  const handleSave = async (data: Omit<MenuSchedule, "id" | "createdAt" | "updatedAt">) => {
    if (!appUser || !activeStore) return;

    setIsSubmitting(true);
    try {
      if (editingSchedule) {
        const docRef = doc(db, "stores", activeStore.id, "menuSchedules", editingSchedule.id);
        await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
        toast({ title: "Schedule Updated" });
      } else {
        const newDocRef = doc(collection(db, "stores", activeStore.id, "menuSchedules"));
        await setDoc(newDocRef, {
          ...data,
          id: newDocRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        toast({ title: "Schedule Created" });
      }

      handleCloseDialog();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: error?.message ?? "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (item: MenuSchedule) => {
    if (!appUser || !activeStore) return;

    const newStatus = !item.isActive;
    const action = newStatus ? "Activate" : "Deactivate";

    const ok = await confirm({
      title: `${action} ${item.name}?`,
      description: newStatus
        ? "This schedule will be available for use."
        : "This schedule will be hidden/disabled for use.",
      confirmText: `Yes, ${action}`,
      destructive: !newStatus,
    });

    if (!ok) return;

    try {
      const docRef = doc(db, "stores", activeStore.id, "menuSchedules", item.id);
      await updateDoc(docRef, { isActive: newStatus, updatedAt: serverTimestamp() });
      toast({ title: "Status Updated" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error?.message ?? "Unknown error",
      });
    }
  };

  const handleDelete = async (item: MenuSchedule) => {
    if (!appUser || !activeStore) return;

    const ok = await confirm({
      title: `Delete ${item.name}?`,
      description: "This action cannot be undone and will permanently delete the schedule.",
      confirmText: "Yes, Delete",
      destructive: true,
    });

    if (!ok) return;

    try {
      await deleteDoc(doc(db, "stores", activeStore.id, "menuSchedules", item.id));
      toast({ title: "Schedule Deleted" });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: error?.message ?? "Unknown error",
      });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Menu Schedules</CardTitle>
          <CardDescription>Manage when menus or items are available for this store.</CardDescription>
        </CardHeader>

        <CardContent>
          <div className="text-right mb-4">
            <Button onClick={() => handleOpenDialog()} disabled={!activeStore}>
              <PlusCircle className="mr-2" /> New Schedule
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader className="animate-spin" />
            </div>
          ) : schedules.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6">No schedules yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {schedules.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      {item.startTime} - {item.endTime}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {(item.days ?? []).join(", ")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.isActive ? "default" : "secondary"}>
                        {item.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenDialog(item)}
                        className="mr-2"
                        disabled={isSubmitting}
                      >
                        Edit
                      </Button>

                      <Button
                        variant={item.isActive ? "secondary" : "default"}
                        size="sm"
                        onClick={() => handleToggleActive(item)}
                        className="mr-2"
                        disabled={isSubmitting}
                      >
                        {item.isActive ? <PowerOff className="mr-2" /> : <Power className="mr-2" />}
                        {item.isActive ? "Deactivate" : "Activate"}
                      </Button>

                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(item)}
                        disabled={isSubmitting}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isDialogOpen && (
        <ScheduleEditDialog
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
          onSave={handleSave}
          item={editingSchedule}
          isSubmitting={isSubmitting}
        />
      )}

      {Dialog}
    </>
  );
}
