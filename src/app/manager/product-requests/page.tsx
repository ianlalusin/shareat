"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Loader, PlusCircle, RotateCcw, Search, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import {
  ProductRequestDialog,
  type ProductRequestFormValues,
} from "@/components/manager/product-requests/product-request-dialog";
import {
  KIND_LABEL,
  STATUS_LABEL,
  canCancel,
  statusBadgeVariant,
} from "@/lib/product-requests/shared";
import type { ProductRequest, ProductRequestStatus } from "@/lib/types";
import { getDisplayName } from "@/lib/products/variants";

const FILTERS: Array<{ value: ProductRequestStatus | "all"; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Declined" },
  { value: "all", label: "All" },
];

function toMs(input: any): number {
  if (!input) return 0;
  if (typeof input.toMillis === "function") return input.toMillis();
  if (typeof input.seconds === "number") return input.seconds * 1000;
  return 0;
}

/** The request doc does not exist yet at upload time, so the id is minted here. */
async function uploadRequestImage(file: File, requestId: string): Promise<string> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r = storageRef(storage, `productRequestImages/${requestId}/${Date.now()}-${safe}`);
  await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
  return await getDownloadURL(r);
}

export default function ManagerProductRequestsPage() {
  const router = useRouter();
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const { confirm, Dialog: confirmDialogElement } = useConfirmDialog();

  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [prefill, setPrefill] = useState<ProductRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProductRequestStatus | "all">("pending");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 250);

  useEffect(() => {
    if (!activeStore) {
      setRequests([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    // Equality filter only — sorting happens client-side so no composite index
    // is needed.
    const q = query(collection(db, "productRequests"), where("storeId", "==", activeStore.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ProductRequest));
        setIsLoading(false);
      },
      (error) => {
        console.error("Failed to fetch product requests:", error);
        toast({ variant: "destructive", title: "Error", description: "Could not load requests." });
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [activeStore, toast]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return requests
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .filter((r) => (term ? getDisplayName(r).toLowerCase().includes(term) : true))
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  }, [requests, statusFilter, debouncedSearch]);

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === "pending").length,
    [requests]
  );

  const handleSave = async (values: ProductRequestFormValues) => {
    if (!activeStore) return;
    setIsSubmitting(true);
    // Pre-allocate the id so the photo can be uploaded under it before the
    // server creates the doc.
    const requestId = doc(collection(db, "productRequests")).id;
    try {
      // A re-raised request keeps the photo already in Storage unless the
      // manager picked a new one.
      let imageUrl: string | null = values.existingImageUrl;
      if (values.imageFile) {
        imageUrl = await uploadRequestImage(values.imageFile, requestId);
      }

      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const idToken = await user.getIdToken();

      const res = await fetch("/api/product-requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "submit",
          requestId,
          storeId: activeStore.id,
          requestKind: values.requestKind,
          name: values.name,
          variant: values.variant || null,
          description: values.description || null,
          subCategory: values.subCategory || null,
          uom: values.uom,
          barcode: values.barcode || null,
          imageUrl,
          suggestedPrice: values.suggestedPrice,
          cost: values.cost,
          kitchenLocationId: values.kitchenLocationId || null,
          justification: values.justification || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Submit failed (${res.status})`);

      toast({
        title: "Request Submitted",
        description: "An admin will review it. You'll see the outcome on this page.",
      });
      setIsDialogOpen(false);
      setPrefill(null);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Submit Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (request: ProductRequest) => {
    const confirmed = await confirm({
      title: `Withdraw the request for ${getDisplayName(request)}?`,
      description: "You can submit it again later.",
      confirmText: "Yes, withdraw",
      destructive: true,
    });
    if (!confirmed) return;

    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const idToken = await user.getIdToken();
      const res = await fetch("/api/product-requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ op: "cancel", requestId: request.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Withdraw failed (${res.status})`);
      toast({ title: "Request Withdrawn" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Withdraw Failed", description: error.message });
    }
  };

  const openNew = () => {
    setPrefill(null);
    setIsDialogOpen(true);
  };

  const openRequestAgain = (request: ProductRequest) => {
    setPrefill(request);
    setIsDialogOpen(true);
  };

  if (!activeStore) {
    return (
      <RoleGuard allow={["admin", "manager"]}>
        <div className="flex items-center justify-center h-full">
          <Card className="w-full max-w-md text-center">
            <CardHeader>
              <CardTitle>No Store Selected</CardTitle>
              <CardDescription>
                Please select a store from the dropdown in the header to raise a product request.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </RoleGuard>
    );
  }

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader
        title="Product Requests"
        description={`Apply to add a new product or add-on to the global catalog for ${activeStore.name}`}
      >
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          <Button size="sm" onClick={openNew}>
            <PlusCircle className="mr-2 h-4 w-4" /> New Request
          </Button>
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle>Your Requests</CardTitle>
              <CardDescription>
                {pendingCount > 0
                  ? `${pendingCount} awaiting admin review.`
                  : "Nothing awaiting review."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 rounded-md bg-muted p-1">
                {FILTERS.map((f) => (
                  <Button
                    key={f.value}
                    variant={statusFilter === f.value ? "default" : "ghost"}
                    size="sm"
                    className="h-8"
                    onClick={() => setStatusFilter(f.value)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search requests…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-full sm:w-56"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <Loader className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              No requests here yet. Use <span className="font-medium">New Request</span> to apply for
              a product that isn&apos;t in the catalog.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Suggested Price</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{getDisplayName(r)}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.subCategory || "Uncategorized"} / {r.uom}
                        </div>
                        {r.status === "rejected" && r.reviewNote && (
                          <div className="text-xs text-destructive mt-1 max-w-xs">
                            Declined: {r.reviewNote}
                          </div>
                        )}
                        {r.status === "approved" && r.autoActivationNote && (
                          <div className="text-xs text-amber-600 mt-1 max-w-xs">
                            {r.autoActivationNote}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{KIND_LABEL[r.requestKind]}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.suggestedPrice ?? 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {toMs(r.createdAt)
                          ? formatDistanceToNow(new Date(toMs(r.createdAt)), { addSuffix: true })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(r.status)}>{STATUS_LABEL[r.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          {canCancel(r, appUser?.uid, appUser?.isPlatformAdmin === true) && (
                            <Button variant="outline" size="sm" onClick={() => handleCancel(r)}>
                              <X className="mr-1 h-3 w-3" /> Withdraw
                            </Button>
                          )}
                          {(r.status === "rejected" || r.status === "cancelled") && (
                            <Button variant="outline" size="sm" onClick={() => openRequestAgain(r)}>
                              <RotateCcw className="mr-1 h-3 w-3" /> Request again
                            </Button>
                          )}
                          {r.status === "approved" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => router.push("/manager/inventory")}
                            >
                              View in Inventory
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProductRequestDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
          setPrefill(null);
        }}
        onSave={handleSave}
        isSubmitting={isSubmitting}
        storeId={activeStore.id}
        prefill={prefill}
      />
      {confirmDialogElement}
    </RoleGuard>
  );
}
