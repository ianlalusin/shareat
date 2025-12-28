
"use client";

import { useState, useEffect } from "react";
import { collection, onSnapshot, doc, setDoc, updateDoc, serverTimestamp, writeBatch, Timestamp, query, orderBy, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { logActivity } from "@/lib/firebase/activity-log";
import { ScheduleEditDialog } from "./schedule-edit-dialog";

export type MenuSchedule = {
  id: string;
  name: string;
  days: string[];
  startTime: string;
  endTime: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export function SchedulesSettings() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<MenuSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<MenuSchedule | null>(null);
  const { confirm, Dialog } = useConfirmDialog();

  useEffect(() => {
    if (!activeStore) {
        setIsLoading(false);
        return;
    }
    const schedulesRef = collection(db, "stores", activeStore.id, "menuSchedules");
    const q = query(schedulesRef, orderBy("name", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MenuSchedule));
      setSchedules(data);
      setIsLoading(false);
    }, (error) => {
      console.error("Failed to fetch schedules:", error);
      toast({ variant: "destructive", title: "Error", description: "Could not fetch schedules." });
      setIsLoading(false);
    });

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

  const handleSave = async (data: Omit<MenuSchedule, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!appUser || !activeStore) return;
    setIsSubmitting(true);

    try {
      if (editingSchedule) {
        const docRef = doc(db, "stores", activeStore.id, "menuSchedules", editingSchedule.id);
        await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
        await logActivity(appUser, "schedule_updated", `Updated schedule: ${data.name}`);
        toast({ title: "Schedule Updated" });
      } else {
        const newDocRef = doc(collection(db, "stores", activeStore.id, "menuSchedules"));
        await setDoc(newDocRef, {
          ...data,
          id: newDocRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await logActivity(appUser, "schedule_created", `Created new schedule: ${data.name}`);
        toast({ title: "Schedule Created" });
      }
      handleCloseDialog();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (item: MenuSchedule) => {
    if (!appUser || !activeStore) return;
    const newStatus = !item.isActive;
    const action = newStatus ? "Activate" : "Deactivate";
    
    if (!(await confirm({
        title: `${action} ${item.name}?`,
        confirmText: `Yes, ${action}`,
    }))) return;

    try {
        const docRef = doc(db, "stores", activeStore.id, "menuSchedules", item.id);
        await updateDoc(docRef, { isActive: newStatus, updatedAt: serverTimestamp() });
        await logActivity(appUser, newStatus ? "schedule_activated" : "schedule_deactivated", `${action}d schedule: ${item.name}`);
        toast({ title: "Status Updated" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
    }
  };
  
  const handleDelete = async (item: MenuSchedule) => {
    if (!appUser || !activeStore) return;

    if (!(await confirm({
        title: `Delete ${item.name}?`,
        description: "This action cannot be undone and will permanently delete the schedule.",
        confirmText: "Yes, Delete",
        destructive: true,
    }))) return;

    try {
        await deleteDoc(doc(db, "stores", activeStore.id, "menuSchedules", item.id));
        await logActivity(appUser, "schedule_deleted", `Deleted schedule: ${item.name}`);
        toast({ title: "Schedule Deleted" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Delete Failed", description: error.message });
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
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2" /> New Schedule
            </Button>
          </div>
          {isLoading ? <Loader className="animate-spin" /> : (
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
                    <TableCell>{item.startTime} - {item.endTime}</TableCell>
                    <TableCell className="max-w-xs truncate">{item.days.join(', ')}</TableCell>
                    <TableCell>
                      <Badge variant={item.isActive ? "default" : "secondary"}>
                        {item.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpenDialog(item)} className="mr-2">Edit</Button>
                      <Button variant={item.isActive ? "secondary" : "default"} size="sm" onClick={() => handleToggleActive(item)} className="mr-2">
                        {item.isActive ? <PowerOff className="mr-2"/> : <Power className="mr-2" />}
                        {item.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(item)}>
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
