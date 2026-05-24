"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Gift, Loader, PlusCircle, Power, PowerOff } from "lucide-react";
import type { LoyaltyReward } from "@/lib/types";

type FormState = {
  name: string;
  description: string;
  type: "fixed" | "percent";
  value: string;
  pointsCost: string;
  sortOrder: string;
  isActive: boolean;
};

const EMPTY: FormState = { name: "", description: "", type: "fixed", value: "", pointsCost: "", sortOrder: "0", isActive: true };

export default function LoyaltyRewardsPage() {
  const router = useRouter();
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();

  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LoyaltyReward | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "loyaltyRewards"), orderBy("sortOrder", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRewards(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LoyaltyReward[]);
        setIsLoading(false);
      },
      () => setIsLoading(false),
    );
    return () => unsub();
  }, []);

  const openNew = () => { setEditing(null); setForm(EMPTY); setDialogOpen(true); };
  const openEdit = (r: LoyaltyReward) => {
    setEditing(r);
    setForm({
      name: r.name, description: r.description ?? "", type: r.type, value: String(r.value),
      pointsCost: String(r.pointsCost), sortOrder: String(r.sortOrder ?? 0), isActive: r.isActive,
    });
    setDialogOpen(true);
  };

  const canSave = useMemo(() => {
    const v = Number(form.value); const p = Number(form.pointsCost);
    return form.name.trim().length > 0 && Number.isFinite(v) && v > 0 && Number.isInteger(p) && p > 0 && !saving;
  }, [form, saving]);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        type: form.type,
        value: Number(form.value),
        pointsCost: Math.floor(Number(form.pointsCost)),
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, "loyaltyRewards", editing.id), payload);
        toast({ title: "Reward updated" });
      } else {
        await addDoc(collection(db, "loyaltyRewards"), {
          ...payload,
          applicableStoreIds: null,
          createdAt: serverTimestamp(),
          createdBy: appUser?.uid ?? null,
        });
        toast({ title: "Reward created" });
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (r: LoyaltyReward) => {
    try {
      await updateDoc(doc(db, "loyaltyRewards", r.id), { isActive: !r.isActive, updatedAt: serverTimestamp() });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update failed", description: e?.message });
    }
  };

  const handleDelete = async (r: LoyaltyReward) => {
    if (!(await confirm({ title: `Delete "${r.name}"?`, description: "Members can no longer redeem this reward. Existing vouchers are unaffected.", confirmText: "Delete", destructive: true }))) return;
    try {
      await deleteDoc(doc(db, "loyaltyRewards", r.id));
      toast({ title: "Reward deleted" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete failed", description: e?.message });
    }
  };

  const fmtValue = (r: LoyaltyReward) => (r.type === "percent" ? `${r.value}% off` : `₱${r.value.toLocaleString()} off`);

  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader title="Loyalty Rewards" description="Rewards members can redeem Sharelebrator points for.">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
          <Button onClick={openNew}><PlusCircle className="mr-2 h-4 w-4" /> New Reward</Button>
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gift className="h-5 w-5 text-primary" /> Rewards Catalog</CardTitle>
          <CardDescription>Global rewards, available at all stores. Points cost is fixed per reward; redeeming applies it as a discount on the bill.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader className="animate-spin" /></div>
          ) : rewards.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No rewards yet. Click "New Reward" to add one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Reward</TableHead>
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rewards.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.name}
                      {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                    </TableCell>
                    <TableCell>{fmtValue(r)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.pointsCost.toLocaleString()}</TableCell>
                    <TableCell><Badge variant={r.isActive ? "default" : "secondary"}>{r.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="mr-2" onClick={() => openEdit(r)}>Edit</Button>
                      <Button variant={r.isActive ? "secondary" : "default"} size="sm" className="mr-2" onClick={() => handleToggle(r)}>
                        {r.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(r)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Reward" : "New Reward"}</DialogTitle>
            <DialogDescription>Members spend points to redeem this; it applies as a bill discount.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. ₱100 off" disabled={saving} />
            </div>
            <div className="space-y-1">
              <Label>Description <span className="text-xs text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={saving} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "fixed" | "percent" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">₱ off (fixed)</SelectItem>
                    <SelectItem value="percent">% off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{form.type === "percent" ? "Percent" : "Amount (₱)"}</Label>
                <Input type="number" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} disabled={saving} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Points cost</Label>
                <Input type="number" inputMode="numeric" value={form.pointsCost} onChange={(e) => setForm({ ...form, pointsCost: e.target.value })} disabled={saving} />
              </div>
              <div className="space-y-1">
                <Label>Sort order</Label>
                <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} disabled={saving} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label>Active</Label>
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={!canSave}>{saving ? <Loader className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {ConfirmDialog}
    </RoleGuard>
  );
}
