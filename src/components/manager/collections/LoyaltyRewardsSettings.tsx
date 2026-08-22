"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { getAuth } from "firebase/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader, Gift } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { isRewardAllowedAtStore, isRewardOfferedAtStore } from "@/lib/loyaltyRewardScope";
import type { LoyaltyReward, Store } from "@/lib/types";

/**
 * Manager view of the global rewards catalogue: every reward an admin has
 * published, with one switch deciding whether this store offers it.
 *
 * The catalogue itself is admin-only — a manager cannot create, price, or
 * delete a reward, only choose which ones their branch honours. The write goes
 * through /api/loyalty/rewards/store-toggle because firestore.rules keeps
 * `loyaltyRewards` writes to admins.
 */
export function LoyaltyRewardsSettings({ store }: { store: Store }) {
  const { appUser, isSigningOut } = useAuthContext();
  const { toast } = useToast();

  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, "loyaltyRewards"),
      (snapshot) => {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as LoyaltyReward);
        data.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
        setRewards(data);
        setIsLoading(false);
      },
      (error) => {
        if (isSigningOut || !appUser) return;
        toast({ variant: "destructive", title: "Error", description: `Could not fetch rewards: ${error.message}` });
        setIsLoading(false);
      }
    );
    return () => unsubscribe();
  }, [toast, isSigningOut, appUser]);

  const offeredCount = useMemo(
    () => rewards.filter((r) => isRewardOfferedAtStore(r, store.id)).length,
    [rewards, store.id]
  );

  const handleToggle = async (reward: LoyaltyReward, offered: boolean) => {
    setSavingId(reward.id);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const res = await fetch("/api/loyalty/rewards/store-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ storeId: store.id, rewardId: reward.id, offered }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Update failed.");
      // The onSnapshot listener above repaints from the written document, so
      // there is no local optimistic state to unwind on failure.
      toast({
        title: offered ? "Now offered here" : "No longer offered here",
        description: `${reward.name} — ${store.name}`,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update failed", description: e?.message });
    } finally {
      setSavingId(null);
    }
  };

  const fmtValue = (r: LoyaltyReward) =>
    r.type === "percent" ? `${r.value}% off` : `₱${Number(r.value).toLocaleString()} off`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="h-5 w-5" /> Loyalty Rewards
        </CardTitle>
        <CardDescription>
          Rewards members redeem Sharelebrator points for. The catalogue is global — switch on the
          ones {store.name} offers. {offeredCount} of {rewards.length} on.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rewards.length === 0 ? (
          <p className="px-6 py-10 text-sm text-center text-muted-foreground">
            No rewards have been published yet. An admin creates them in Global Settings → Loyalty Rewards.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reward</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Points</TableHead>
                <TableHead className="text-right">Offer here</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rewards.map((r) => {
                const allowed = isRewardAllowedAtStore(r, store.id);
                const offered = isRewardOfferedAtStore(r, store.id);
                const globallyOff = r.isActive === false;
                return (
                  <TableRow key={r.id} className={offered ? "" : "opacity-70"}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      {r.description && (
                        <div className="text-xs text-muted-foreground">{r.description}</div>
                      )}
                      {globallyOff && (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          Paused by admin
                        </Badge>
                      )}
                      {!allowed && !globallyOff && (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          Scoped to other branches
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtValue(r)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {Number(r.pointsCost).toLocaleString()} pts
                    </TableCell>
                    <TableCell className="text-right">
                      {savingId === r.id ? (
                        <Loader className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Switch
                          checked={offered}
                          // A reward the admin paused or scoped elsewhere is not
                          // this manager's to switch on; the route refuses it too.
                          disabled={globallyOff || !allowed}
                          onCheckedChange={(v) => handleToggle(r, v)}
                          aria-label={`Offer ${r.name} at ${store.name}`}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
