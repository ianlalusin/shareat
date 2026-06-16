"use client";

import { useCallback, useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Loader2, Plus, Pencil, Archive, RefreshCw, ArrowLeft, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useStoreContext } from "@/context/store-context";
import { OptionGroupEditDialog } from "@/components/admin/option-groups/OptionGroupEditDialog";
import { getStorefrontStoreId, publishStorefrontNow } from "@/lib/storefront/auto-publish";
import type { OptionGroup } from "@/lib/types";

const vKey = (groupId: string, valueId: string) => `${groupId}:${valueId}`;

export default function OptionGroupsClient() {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const { activeStore, activeStoreId } = useStoreContext();
  const activeStoreName = activeStore?.name || activeStoreId || "";

  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<OptionGroup | null>(null);

  // Per-store availability overlay for the active store.
  const [disabledGroupIds, setDisabledGroupIds] = useState<Set<string>>(new Set());
  const [disabledValueKeys, setDisabledValueKeys] = useState<Set<string>>(new Set());
  const [overridesLoading, setOverridesLoading] = useState(false);
  const [savingOverrides, setSavingOverrides] = useState(false);

  const callApi = useCallback(async (path: string, init?: RequestInit) => {
    const user = getAuth().currentUser;
    if (!user) throw new Error("Not signed in.");
    const idToken = await user.getIdToken();
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        Authorization: `Bearer ${idToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || !json?.ok) throw new Error(json?.error || `Request failed (${res.status})`);
    return json;
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const json = await callApi(`/api/admin/option-groups?includeArchived=${showArchived ? "true" : "false"}`);
      setGroups(json.groups || []);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to load", description: e?.message });
    } finally {
      setIsLoading(false);
    }
  }, [callApi, showArchived, toast]);

  useEffect(() => { void load(); }, [load]);

  const loadOverrides = useCallback(async () => {
    if (!activeStoreId) {
      setDisabledGroupIds(new Set());
      setDisabledValueKeys(new Set());
      return;
    }
    setOverridesLoading(true);
    try {
      const json = await callApi(`/api/admin/option-overrides?storeId=${encodeURIComponent(activeStoreId)}`);
      setDisabledGroupIds(new Set((json.disabledGroupIds || []).map(String)));
      setDisabledValueKeys(new Set((json.disabledValueKeys || []).map(String)));
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to load store availability", description: e?.message });
    } finally {
      setOverridesLoading(false);
    }
  }, [activeStoreId, callApi, toast]);

  useEffect(() => { void loadOverrides(); }, [loadOverrides]);

  const persistOverrides = useCallback(
    async (nextGroups: Set<string>, nextValues: Set<string>) => {
      if (!activeStoreId) return;
      setSavingOverrides(true);
      try {
        await callApi(`/api/admin/option-overrides`, {
          method: "PUT",
          body: JSON.stringify({
            storeId: activeStoreId,
            disabledGroupIds: [...nextGroups],
            disabledValueKeys: [...nextValues],
          }),
        });
        // The cashier reads availability live, but the public storefront snapshot
        // is denormalized — rebuild it when the edited store is the pilot store.
        if (activeStoreId === getStorefrontStoreId()) {
          void publishStorefrontNow(activeStoreId, (r) => {
            if (!r.ok) toast({ variant: "destructive", title: "Storefront rebuild failed", description: r.error });
          });
        }
      } catch (e: any) {
        toast({ variant: "destructive", title: "Save failed", description: e?.message });
        await loadOverrides(); // resync from server
      } finally {
        setSavingOverrides(false);
      }
    },
    [activeStoreId, callApi, loadOverrides, toast]
  );

  function toggleGroupAvailability(g: OptionGroup) {
    if (!activeStoreId) return;
    const next = new Set(disabledGroupIds);
    if (next.has(g.id)) next.delete(g.id);
    else next.add(g.id);
    setDisabledGroupIds(next);
    void persistOverrides(next, disabledValueKeys);
  }

  function toggleValueAvailability(g: OptionGroup, valueId: string) {
    if (!activeStoreId) return;
    const key = vKey(g.id, valueId);
    const next = new Set(disabledValueKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      // Don't let a store strip every choice from a group that's still offered —
      // it would leave a required group unsatisfiable. Force the group toggle.
      const enabledCount = (g.values || []).filter(
        (v) => v.isActive && !next.has(vKey(g.id, v.id))
      ).length;
      if (enabledCount <= 1) {
        toast({
          variant: "destructive",
          title: "Keep at least one choice",
          description: `${g.name} would have no options left at ${activeStoreName}. Turn the whole group off instead.`,
        });
        return;
      }
      next.add(key);
    }
    setDisabledValueKeys(next);
    void persistOverrides(disabledGroupIds, next);
  }

  function openCreate() {
    setEditing(null);
    setEditOpen(true);
  }
  function openEdit(g: OptionGroup) {
    setEditing(g);
    setEditOpen(true);
  }

  async function handleArchive(g: OptionGroup) {
    const ok = await confirm({
      title: `Archive "${g.name}"?`,
      description: "Products that still reference this option group will keep doing so, but it won't appear in pickers for new products.",
      destructive: true,
      confirmText: "Archive",
    });
    if (!ok) return;
    try {
      await callApi(`/api/admin/option-groups/${g.id}`, { method: "DELETE" });
      toast({ title: "Archived" });
      await load();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Archive failed", description: e?.message });
    }
  }

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader title="Option Groups" description="Reusable modifier groups (e.g. Cheese, Size) that can be attached to products.">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={() => setShowArchived((v) => !v)} variant={showArchived ? "default" : "outline"}>
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> New Option Group
          </Button>
        </div>
      </PageHeader>

      {activeStoreId && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <Store className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <span className="font-medium">Availability at {activeStoreName}.</span>{" "}
            <span className="text-muted-foreground">
              Toggle whole groups or individual values off for this store only — the group itself stays shared across all stores.
              Everything is on by default. Cashiers see changes immediately; the public website updates on the next storefront rebuild.
            </span>
            {(overridesLoading || savingOverrides) && (
              <Loader2 className="h-3.5 w-3.5 inline ml-2 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All option groups</CardTitle>
          <CardDescription>Each group has a selection mode and a list of values with optional price deltas.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 inline animate-spin" /></div>
          ) : groups.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No option groups yet. Create one to get started.
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => {
                const activeValues = (g.values || []).filter((v) => v.isActive);
                const archived = g.isArchived === true;
                const groupOff = activeStoreId ? disabledGroupIds.has(g.id) : false;
                const canEditStore = !!activeStoreId && !archived;
                return (
                  <div
                    key={g.id}
                    className={`rounded-lg border p-3 flex items-start gap-3 ${archived ? "opacity-60 bg-muted/40" : groupOff ? "opacity-70 bg-muted/20" : "hover:bg-muted/30"}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{g.name}</span>
                        <Badge variant={g.selectionMode === "single" ? "outline" : "secondary"} className="text-xs">
                          {g.selectionMode === "single" ? "Single-select" : "Multi-select"}
                        </Badge>
                        {g.required && <Badge variant="default" className="text-xs">Required</Badge>}
                        {!g.isActive && !archived && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                        {archived && <Badge variant="destructive" className="text-xs">Archived</Badge>}
                        {groupOff && <Badge variant="destructive" className="text-xs">Off at {activeStoreName}</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {activeValues.length} value{activeValues.length === 1 ? "" : "s"}
                        {g.selectionMode === "multi" && (
                          <>
                            {" · "}
                            {`min ${g.required ? (g.minSelections ?? 1) : 0}`}
                            {g.maxSelections != null ? ` / max ${g.maxSelections}` : " / max unlimited"}
                          </>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {activeValues.map((v) => {
                          const valueOff = activeStoreId ? disabledValueKeys.has(vKey(g.id, v.id)) : false;
                          const off = groupOff || valueOff;
                          const label = (
                            <>
                              {v.name}
                              {v.priceDelta !== 0 && (
                                <span className={`ml-1 ${v.priceDelta > 0 ? "text-emerald-700" : "text-red-700"}`}>
                                  {v.priceDelta > 0 ? "+" : ""}₱{Number(v.priceDelta).toLocaleString()}
                                </span>
                              )}
                            </>
                          );
                          if (!canEditStore) {
                            return (
                              <Badge key={v.id} variant="outline" className="text-[11px]">{label}</Badge>
                            );
                          }
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => toggleValueAvailability(g, v.id)}
                              disabled={groupOff || savingOverrides}
                              title={off ? `Off at ${activeStoreName} — click to offer it here` : `Click to hide at ${activeStoreName}`}
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                                off
                                  ? "line-through opacity-50 bg-muted text-muted-foreground"
                                  : "hover:bg-primary/10 border-primary/40"
                              } ${groupOff ? "cursor-not-allowed" : "cursor-pointer"}`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => openEdit(g)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {!archived && (
                          <Button variant="ghost" size="sm" onClick={() => handleArchive(g)} title="Archive">
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {canEditStore && (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                          <span>Offered here</span>
                          <Switch
                            checked={!groupOff}
                            onCheckedChange={() => toggleGroupAvailability(g)}
                            disabled={savingOverrides}
                            aria-label={`Offer ${g.name} at ${activeStoreName}`}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {editOpen && (
        <OptionGroupEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          group={editing}
          onSaved={async () => {
            setEditOpen(false);
            await load();
          }}
        />
      )}

      {ConfirmDialog}
    </RoleGuard>
  );
}
