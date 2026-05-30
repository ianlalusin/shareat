"use client";

import { useCallback, useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Loader2, Plus, Pencil, Archive, RefreshCw, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { OptionGroupEditDialog } from "@/components/admin/option-groups/OptionGroupEditDialog";
import type { OptionGroup } from "@/lib/types";

export default function OptionGroupsClient() {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();

  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<OptionGroup | null>(null);

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
                return (
                  <div
                    key={g.id}
                    className={`rounded-lg border p-3 flex items-start gap-3 ${archived ? "opacity-60 bg-muted/40" : "hover:bg-muted/30"}`}
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
                        {activeValues.slice(0, 8).map((v) => (
                          <Badge key={v.id} variant="outline" className="text-[11px]">
                            {v.name}
                            {v.priceDelta !== 0 && (
                              <span className={`ml-1 ${v.priceDelta > 0 ? "text-emerald-700" : "text-red-700"}`}>
                                {v.priceDelta > 0 ? "+" : ""}₱{Number(v.priceDelta).toLocaleString()}
                              </span>
                            )}
                          </Badge>
                        ))}
                        {activeValues.length > 8 && <Badge variant="outline" className="text-[11px]">+{activeValues.length - 8} more</Badge>}
                      </div>
                    </div>
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
