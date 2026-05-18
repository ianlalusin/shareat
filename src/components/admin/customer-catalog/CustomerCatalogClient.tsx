"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil, Eye, EyeOff, Trash2, Upload, Link2, X as XIcon, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type CatalogItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  isArchived: boolean;
  linkedPosProductId: string | null;
  linkedPosProductName: string | null;
};

type StoreCacheItem = CatalogItem & {
  storeUpdatedAtMs?: number | null;
  globalIsAvailable?: boolean;
};

type Category = { id: string; name: string; isActive: boolean; sortOrder: number };
type PosProduct = { id: string; name: string; category?: string };

export default function CustomerCatalogClient() {
  const { user, appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();

  const [tab, setTab] = useState<"global" | "store">("global");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive">("active");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [storeItems, setStoreItems] = useState<StoreCacheItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const storeId = activeStore?.id || "";

  const callApi = useCallback(
    async (path: string, init?: RequestInit) => {
      const u = user || getAuth().currentUser;
      if (!u) throw new Error("Not signed in.");
      const idToken = await u.getIdToken();
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
    },
    [user]
  );

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      const data = await callApi(`/api/admin/customer-catalog/data?${params.toString()}`);
      setItems(data.items || []);
      setCategories(data.categories || []);
      setStoreItems(data.storeItems || []);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to load", description: e?.message });
    } finally {
      setIsLoading(false);
    }
  }, [storeId, callApi, toast]);

  useEffect(() => {
    if (!user) return;
    void loadData();
  }, [user, loadData]);

  const op = useCallback(
    async (body: Record<string, any>) => {
      setIsBusy(true);
      try {
        await callApi("/api/admin/customer-catalog/op", {
          method: "POST",
          body: JSON.stringify({ storeId, ...body }),
        });
        await loadData();
      } catch (e: any) {
        toast({ variant: "destructive", title: "Action failed", description: e?.message });
        throw e;
      } finally {
        setIsBusy(false);
      }
    },
    [callApi, loadData, storeId, toast]
  );

  // ----- Add dialog state -----
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [addPrice, setAddPrice] = useState("0");
  const [addImageFile, setAddImageFile] = useState<File | null>(null);

  // ----- Edit dialog state -----
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<CatalogItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPrice, setEditPrice] = useState("0");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editLinkedId, setEditLinkedId] = useState<string | null>(null);
  const [editLinkedName, setEditLinkedName] = useState<string | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<PosProduct[]>([]);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);

  function openEdit(it: CatalogItem | StoreCacheItem) {
    setEditItem(it as CatalogItem);
    setEditName(it.name);
    setEditCategory(it.category || (categories[0]?.name ?? "Add-on"));
    setEditPrice(String(it.price ?? 0));
    setEditImageFile(null);
    setEditLinkedId(it.linkedPosProductId ?? null);
    setEditLinkedName(it.linkedPosProductName ?? null);
    setLinkSearch("");
    setLinkResults([]);
    setLinkPickerOpen(false);
    setEditOpen(true);
  }

  // Debounced POS product search
  useEffect(() => {
    if (!editOpen || !linkPickerOpen) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setLinkLoading(true);
        const params = new URLSearchParams();
        if (linkSearch.trim()) params.set("q", linkSearch.trim());
        const json = await callApi(`/api/admin/customer-catalog/pos-products?${params.toString()}`);
        if (!cancelled) setLinkResults(json.products || []);
      } catch {
        if (!cancelled) setLinkResults([]);
      } finally {
        if (!cancelled) setLinkLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [editOpen, linkPickerOpen, linkSearch, callApi]);

  async function uploadImage(file: File, itemId: string): Promise<string> {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `catalogImages/${itemId}/${Date.now()}-${safe}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
    return await getDownloadURL(r);
  }

  async function handleCreate() {
    if (!addName.trim()) return;
    try {
      const created = await callApi("/api/admin/customer-catalog/op", {
        method: "POST",
        body: JSON.stringify({
          op: "create",
          storeId,
          name: addName.trim(),
          category: addCategory.trim() || (categories[0]?.name ?? "Add-on"),
          price: Number(addPrice) || 0,
        }),
      });
      if (addImageFile) {
        const url = await uploadImage(addImageFile, created.id);
        await callApi("/api/admin/customer-catalog/op", {
          method: "POST",
          body: JSON.stringify({ op: "update", storeId, id: created.id, imageUrl: url }),
        });
      }
      setAddName("");
      setAddPrice("0");
      setAddImageFile(null);
      setIsAddOpen(false);
      toast({ title: "Added" });
      await loadData();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Create failed", description: e?.message });
    }
  }

  async function handleSaveEdit() {
    if (!editItem) return;
    setIsBusy(true);
    try {
      const linkChanged =
        (editItem.linkedPosProductId ?? null) !== (editLinkedId ?? null) ||
        (editItem.linkedPosProductName ?? null) !== (editLinkedName ?? null);

      let nextImageUrl: string | undefined;
      if (editImageFile) {
        nextImageUrl = await uploadImage(editImageFile, editItem.id);
      }

      if (tab === "store") {
        await callApi("/api/admin/customer-catalog/op", {
          method: "POST",
          body: JSON.stringify({
            op: "store-override",
            storeId,
            id: editItem.id,
            name: editName.trim(),
            category: editCategory.trim(),
            price: Number(editPrice) || 0,
            ...(nextImageUrl !== undefined ? { imageUrl: nextImageUrl } : {}),
          }),
        });
      } else {
        await callApi("/api/admin/customer-catalog/op", {
          method: "POST",
          body: JSON.stringify({
            op: "update",
            storeId,
            id: editItem.id,
            name: editName.trim(),
            category: editCategory.trim(),
            price: Number(editPrice) || 0,
            ...(nextImageUrl !== undefined ? { imageUrl: nextImageUrl } : {}),
          }),
        });
      }

      if (linkChanged) {
        await callApi("/api/admin/customer-catalog/op", {
          method: "POST",
          body: JSON.stringify({
            op: "set-link",
            storeId,
            id: editItem.id,
            linkedPosProductId: editLinkedId,
            linkedPosProductName: editLinkedName,
          }),
        });
      }

      setEditOpen(false);
      toast({ title: "Saved" });
      await loadData();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleToggleGlobalAvail(it: CatalogItem) {
    await op({ op: "toggle-global-avail", id: it.id, isAvailable: !it.isAvailable });
  }
  async function handleArchive(it: CatalogItem) {
    await op({ op: "archive", id: it.id });
  }
  async function handleRevive(it: CatalogItem) {
    await op({ op: "revive", id: it.id });
  }
  async function handleStoreToggle(it: StoreCacheItem) {
    await op({ op: "store-toggle-avail", id: it.id });
  }
  async function handleRebuildCache() {
    if (!storeId) return;
    await op({ op: "rebuild-cache" });
    toast({ title: "Store cache rebuilt" });
  }

  const globalActive = items.filter((x) => !x.isArchived);
  const globalInactive = items.filter((x) => x.isArchived);
  const storeActive = storeItems.filter((x: any) => x?.isAvailable !== false);
  const storeInactive = storeItems.filter((x: any) => x?.isAvailable === false);
  const globalById = useMemo(() => new Map(items.map((x) => [x.id, x])), [items]);
  const isGlobalActive = (id: string) => {
    const g = globalById.get(id);
    if (!g) return true;
    return !g.isArchived && g.isAvailable;
  };

  const currentList: (CatalogItem | StoreCacheItem)[] =
    tab === "global"
      ? (statusFilter === "active" ? globalActive : globalInactive)
      : (statusFilter === "active" ? storeActive : storeInactive);

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader
        title="Customer App Catalog"
        description="Manage items shown on the customer-facing menu, and link each to a POS product."
      >
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading || isBusy}>
            {isLoading || isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
          <Button size="sm" onClick={() => setIsAddOpen(true)} disabled={isBusy}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
      </PageHeader>

      {!activeStore ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Select a store</CardTitle>
            <CardDescription>Pick a store from the header dropdown to see its per-store availability and rebuild its cache.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Tabs value={tab} onValueChange={(v) => setTab(v as "global" | "store")}>
                <TabsList>
                  <TabsTrigger value="global">Global</TabsTrigger>
                  <TabsTrigger value="store" disabled={!storeId}>
                    Store {activeStore?.name ? `(${activeStore.name})` : ""}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-2">
                <Button
                  variant={statusFilter === "active" ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  onClick={() => setStatusFilter("active")}
                >
                  Active
                </Button>
                <Button
                  variant={statusFilter === "inactive" ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  onClick={() => setStatusFilter("inactive")}
                >
                  Inactive
                </Button>
                {tab === "store" && storeId && (
                  <Button variant="outline" size="sm" className="h-8" onClick={handleRebuildCache} disabled={isBusy}>
                    Rebuild Cache
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="py-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 inline animate-spin" /></div>
            ) : currentList.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No items.</div>
            ) : (
              currentList.map((it: any) => (
                <div
                  key={it.id}
                  className={cn(
                    "flex items-center justify-between border rounded-xl p-3 gap-3 transition-colors",
                    tab === "global" && it.isArchived ? "opacity-60 bg-muted/40" : "hover:bg-muted/30"
                  )}
                >
                  <div className="h-12 w-12 rounded-lg overflow-hidden bg-muted flex items-center justify-center shrink-0 border">
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.imageUrl} alt={it.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">No image</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{it.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {it.category} • ₱{Number(it.price || 0).toLocaleString()} • {it.isAvailable ? "Available" : "Hidden"}
                    </div>
                    <div className={cn("mt-0.5 text-[11px] flex items-center gap-1",
                      it.linkedPosProductId ? "text-emerald-700" : "text-muted-foreground/70"
                    )}>
                      <Link2 className="h-3 w-3" />
                      {it.linkedPosProductId ? (
                        <>Linked: <span className="font-medium truncate max-w-[220px]">{it.linkedPosProductName || it.linkedPosProductId}</span></>
                      ) : (
                        "Not linked"
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button variant="outline" size="icon" onClick={() => openEdit(it)} disabled={isBusy} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => tab === "global" ? handleToggleGlobalAvail(it) : handleStoreToggle(it)}
                      disabled={isBusy || (tab === "store" && !isGlobalActive(it.id))}
                      aria-label={it.isAvailable ? "Hide" : "Show"}
                    >
                      {it.isAvailable ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    {tab === "global" && (
                      it.isArchived ? (
                        <Button variant="outline" size="sm" className="h-9" onClick={() => handleRevive(it)} disabled={isBusy}>
                          Revive
                        </Button>
                      ) : (
                        <Button variant="destructive" size="icon" onClick={() => handleArchive(it)} disabled={isBusy} aria-label="Archive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Add dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add product</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Name" value={addName} onChange={(e) => setAddName(e.target.value)} disabled={isBusy} />
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">Category</label>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={addCategory}
                onChange={(e) => setAddCategory(e.target.value)}
                disabled={isBusy}
              >
                {categories.length === 0 ? (
                  <option value="Add-on">Add-on</option>
                ) : (
                  categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)
                )}
              </select>
            </div>
            <Input placeholder="Price" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} disabled={isBusy} />
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer border rounded-md px-3 h-10 hover:bg-muted/40 transition-colors">
              <Upload className="h-4 w-4" />
              <span>{addImageFile ? addImageFile.name : "Upload image (optional)"}</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setAddImageFile(e.target.files?.[0] ?? null)} disabled={isBusy} />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setIsAddOpen(false)} disabled={isBusy}>Cancel</Button>
              <Button onClick={handleCreate} disabled={isBusy || !addName.trim()}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit product</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Input placeholder="Name" value={editName} onChange={(e) => setEditName(e.target.value)} disabled={isBusy} />
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground">Category</label>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                disabled={isBusy}
              >
                {categories.length === 0 ? (
                  <option value="Add-on">Add-on</option>
                ) : (
                  categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)
                )}
              </select>
            </div>
            <Input placeholder="Price" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} disabled={isBusy} />
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer border rounded-md px-3 h-10 hover:bg-muted/40 transition-colors">
              <Upload className="h-4 w-4" />
              <span>{editImageFile ? editImageFile.name : "Upload new image (optional)"}</span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setEditImageFile(e.target.files?.[0] ?? null)} disabled={isBusy} />
            </label>

            {/* Link picker */}
            <div className="grid gap-1">
              <label className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5" /> Linked POS product
              </label>
              {editLinkedId && !linkPickerOpen ? (
                <div className="flex items-center justify-between gap-2 border rounded-md px-3 h-10 bg-muted/40">
                  <span className="text-sm truncate font-medium">{editLinkedName || editLinkedId}</span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setLinkPickerOpen(true); setLinkSearch(""); }} disabled={isBusy}>Change</Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEditLinkedId(null); setEditLinkedName(null); }} disabled={isBusy} title="Unlink"><XIcon className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Search POS products by name…"
                    value={linkSearch}
                    onFocus={() => setLinkPickerOpen(true)}
                    onChange={(e) => { setLinkSearch(e.target.value); setLinkPickerOpen(true); }}
                    disabled={isBusy}
                  />
                  {linkPickerOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg z-10">
                      {linkLoading ? (
                        <div className="p-3 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
                      ) : linkResults.length === 0 ? (
                        <div className="p-3 text-center text-sm text-muted-foreground">{linkSearch.trim() ? "No matches" : "Start typing to search"}</div>
                      ) : (
                        linkResults.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 border-b last:border-b-0"
                            onClick={() => {
                              setEditLinkedId(p.id);
                              setEditLinkedName(p.name);
                              setLinkPickerOpen(false);
                              setLinkSearch("");
                            }}
                          >
                            <div className="font-medium truncate">{p.name}</div>
                            {p.category && <div className="text-xs text-muted-foreground truncate">{p.category}</div>}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditOpen(false)} disabled={isBusy}>Cancel</Button>
              <Button onClick={handleSaveEdit} disabled={isBusy || !editItem || !editName.trim()}>
                {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </RoleGuard>
  );
}
