"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { db, storage } from "@/lib/firebase/client";
import { getAuth } from "firebase/auth";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
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
import { ArrowLeft, BarChart3, Gift, ImageIcon, Loader, PlusCircle, Power, PowerOff } from "lucide-react";
import type { LoyaltyReward } from "@/lib/types";

type FormState = {
  name: string;
  description: string;
  type: "fixed" | "percent";
  value: string;
  pointsCost: string;
  sortOrder: string;
  maxPerVisit: string;
  maxClaimsPerStore: string;
  isActive: boolean;
  imageUrl: string | null;
};

const EMPTY: FormState = { name: "", description: "", type: "fixed", value: "", pointsCost: "", sortOrder: "0", maxPerVisit: "1", maxClaimsPerStore: "", isActive: true, imageUrl: null };

type RewardStats = {
  totals: { totalClaims: number; appliedClaims: number; pendingClaims: number; expiredClaims: number; cancelledClaims: number; totalPointsSpent: number; storeCount: number };
  byStore: Array<{ storeId: string; storeName: string; claims: number; points: number }>;
  recent: Array<{ id: string; ts: number; status: string; source: string; storeName: string | null; pointsCost: number; phone: string }>;
};

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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [statsReward, setStatsReward] = useState<LoyaltyReward | null>(null);
  const [statsData, setStatsData] = useState<RewardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

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

  const openNew = () => { setEditing(null); setForm(EMPTY); setImageFile(null); setDialogOpen(true); };
  const openEdit = (r: LoyaltyReward) => {
    setEditing(r);
    setImageFile(null);
    setForm({
      name: r.name, description: r.description ?? "", type: r.type, value: String(r.value),
      pointsCost: String(r.pointsCost), sortOrder: String(r.sortOrder ?? 0),
      maxPerVisit: String(r.maxPerVisit ?? 1),
      maxClaimsPerStore: r.maxClaimsPerStore ? String(r.maxClaimsPerStore) : "",
      isActive: r.isActive,
      imageUrl: r.imageUrl ?? null,
    });
    setDialogOpen(true);
  };

  async function uploadRewardImage(file: File, rewardId: string): Promise<string> {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `loyaltyRewardImages/${rewardId}/${Date.now()}-${safe}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
    return await getDownloadURL(r);
  }

  const openStats = async (r: LoyaltyReward) => {
    setStatsReward(r);
    setStatsData(null);
    setStatsLoading(true);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/loyalty/reward-stats?rewardId=${encodeURIComponent(r.id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load usage.");
      setStatsData({ totals: json.totals, byStore: json.byStore, recent: json.recent });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not load usage", description: e?.message });
      setStatsReward(null);
    } finally {
      setStatsLoading(false);
    }
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
        maxPerVisit: Math.max(1, Math.floor(Number(form.maxPerVisit) || 1)),
        maxClaimsPerStore: form.maxClaimsPerStore.trim() === "" ? null : Math.max(0, Math.floor(Number(form.maxClaimsPerStore) || 0)),
        isActive: form.isActive,
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        const imageUrl = imageFile ? await uploadRewardImage(imageFile, editing.id) : (form.imageUrl ?? null);
        await updateDoc(doc(db, "loyaltyRewards", editing.id), { ...payload, imageUrl });
        toast({ title: "Reward updated" });
      } else {
        const ref = await addDoc(collection(db, "loyaltyRewards"), {
          ...payload,
          imageUrl: null,
          applicableStoreIds: null,
          createdAt: serverTimestamp(),
          createdBy: appUser?.uid ?? null,
        });
        if (imageFile) {
          const url = await uploadRewardImage(imageFile, ref.id);
          await updateDoc(doc(db, "loyaltyRewards", ref.id), { imageUrl: url, updatedAt: serverTimestamp() });
        }
        toast({ title: "Reward created" });
      }
      setDialogOpen(false);
      setImageFile(null);
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
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-muted flex items-center justify-center">
                          {r.imageUrl ? (
                            <img src={r.imageUrl} alt={r.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          {r.name}
                          {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{fmtValue(r)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.pointsCost.toLocaleString()}</TableCell>
                    <TableCell><Badge variant={r.isActive ? "default" : "secondary"}>{r.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="mr-2" onClick={() => openStats(r)}><BarChart3 className="h-4 w-4 mr-1" /> Usage</Button>
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
            <div className="space-y-1">
              <Label>Photo <span className="text-xs text-muted-foreground font-normal">(optional — shown in the customer app)</span></Label>
              <div className="flex items-center gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted flex items-center justify-center">
                  {imageFile ? (
                    <img src={URL.createObjectURL(imageFile)} alt="preview" className="h-full w-full object-cover" />
                  ) : form.imageUrl ? (
                    <img src={form.imageUrl} alt="current" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <Input type="file" accept="image/*" disabled={saving} onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} className="text-sm" />
                  {(imageFile || form.imageUrl) && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 w-fit px-2 text-muted-foreground" disabled={saving}
                      onClick={() => { setImageFile(null); setForm({ ...form, imageUrl: null }); }}>
                      Remove photo
                    </Button>
                  )}
                </div>
              </div>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Max per visit</Label>
                <Input type="number" min={1} inputMode="numeric" value={form.maxPerVisit} onChange={(e) => setForm({ ...form, maxPerVisit: e.target.value })} disabled={saving} />
                <p className="text-[11px] text-muted-foreground">Times one customer can claim this, per visit.</p>
              </div>
              <div className="space-y-1">
                <Label>Max claims / store</Label>
                <Input type="number" min={0} inputMode="numeric" placeholder="Unlimited" value={form.maxClaimsPerStore} onChange={(e) => setForm({ ...form, maxClaimsPerStore: e.target.value })} disabled={saving} />
                <p className="text-[11px] text-muted-foreground">Blank = unlimited. Total claims per store.</p>
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
      <Dialog open={statsReward !== null} onOpenChange={(o) => { if (!o) { setStatsReward(null); setStatsData(null); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" /> Usage — {statsReward?.name}</DialogTitle>
            <DialogDescription>Claims, points spent, and where this reward is being used.</DialogDescription>
          </DialogHeader>

          {statsLoading || !statsData ? (
            <div className="flex justify-center py-12"><Loader className="animate-spin" /></div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Total claims</div>
                  <div className="text-2xl font-semibold tabular-nums">{statsData.totals.totalClaims.toLocaleString()}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Used (applied)</div>
                  <div className="text-2xl font-semibold tabular-nums">{statsData.totals.appliedClaims.toLocaleString()}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Pending vouchers</div>
                  <div className="text-2xl font-semibold tabular-nums">{statsData.totals.pendingClaims.toLocaleString()}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Points spent</div>
                  <div className="text-2xl font-semibold tabular-nums">{statsData.totals.totalPointsSpent.toLocaleString()}</div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">Per store ({statsData.totals.storeCount})</h4>
                {statsData.byStore.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Not used at any store yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Store</TableHead><TableHead className="text-right">Claims</TableHead><TableHead className="text-right">Points spent</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {statsData.byStore.map((s) => (
                        <TableRow key={s.storeId}>
                          <TableCell className="font-medium">{s.storeName}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.claims.toLocaleString()}</TableCell>
                          <TableCell className="text-right tabular-nums">{s.points.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">Usage log</h4>
                {statsData.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No redemptions yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead><TableHead>Store</TableHead><TableHead>Customer</TableHead>
                        <TableHead className="text-right">Points</TableHead><TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statsData.recent.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-xs">{row.ts ? new Date(row.ts).toLocaleString() : "—"}</TableCell>
                          <TableCell className="text-xs">{row.storeName ?? "—"}</TableCell>
                          <TableCell className="text-xs">{row.phone || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.pointsCost.toLocaleString()}</TableCell>
                          <TableCell><Badge variant={row.status === "applied" ? "default" : row.status === "active" ? "secondary" : "outline"}>{row.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">Showing up to 60 most recent. Source-of-truth is server-side.</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {ConfirmDialog}
    </RoleGuard>
  );
}
