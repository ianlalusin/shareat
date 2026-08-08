"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Loader, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ReviewRequestDialog } from "@/components/admin/product-requests/review-request-dialog";
import { KIND_LABEL, STATUS_LABEL, statusBadgeVariant } from "@/lib/product-requests/shared";
import { getDisplayName } from "@/lib/products/variants";
import type { ProductRequest, ProductRequestStatus } from "@/lib/types";

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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function AdminProductRequestsPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selected, setSelected] = useState<ProductRequest | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ProductRequestStatus | "all">("pending");
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounce(searchTerm, 250);

  useEffect(() => {
    // orderBy on a single field only — served by the automatic index.
    const q = query(collection(db, "productRequests"), orderBy("createdAt", "desc"), limit(200));
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
  }, [toast]);

  // Keep the open dialog in sync with the live snapshot so the footer switches to
  // "Close" the moment the decision lands.
  useEffect(() => {
    if (!selected) return;
    const fresh = requests.find((r) => r.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [requests, selected]);

  const counts = useMemo(
    () => ({
      pending: requests.filter((r) => r.status === "pending").length,
      approved: requests.filter((r) => r.status === "approved").length,
      rejected: requests.filter((r) => r.status === "rejected").length,
      total: requests.length,
    }),
    [requests]
  );

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return requests
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .filter((r) =>
        term
          ? getDisplayName(r).toLowerCase().includes(term) ||
            String(r.storeName || "").toLowerCase().includes(term)
          : true
      );
  }, [requests, statusFilter, debouncedSearch]);

  async function post(payload: Record<string, unknown>) {
    const user = getAuth().currentUser;
    if (!user) throw new Error("Not signed in.");
    const idToken = await user.getIdToken();
    const res = await fetch("/api/product-requests", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  const handleApprove = async (
    request: ProductRequest,
    opts: { force: boolean; reviewNote: string | null }
  ) => {
    setIsSubmitting(true);
    try {
      const { res, json } = await post({
        op: "approve",
        requestId: request.id,
        force: opts.force,
        reviewNote: opts.reviewNote,
      });

      if (!res.ok || !json?.ok) {
        // A catalog collision comes back 409 with the offending product id.
        // Surface it in the dialog so the admin can override or decline.
        if (res.status === 409 && json?.duplicateProductId) {
          setDuplicateWarning(json.error);
          return;
        }
        throw new Error(json?.error || `Approve failed (${res.status})`);
      }

      setDuplicateWarning(null);
      if (json.warning) {
        toast({
          title: "Approved with a caveat",
          description: json.warning,
        });
      } else {
        toast({
          title: "Request Approved",
          description: `${getDisplayName(request)} is now in the catalog and live at ${request.storeName}.`,
        });
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Approve Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecline = async (request: ProductRequest, reviewNote: string) => {
    setIsSubmitting(true);
    try {
      const { res, json } = await post({ op: "reject", requestId: request.id, reviewNote });
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Decline failed (${res.status})`);
      toast({ title: "Request Declined", description: "The manager can see your reason." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Decline Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openReview = (request: ProductRequest) => {
    setDuplicateWarning(null);
    setSelected(request);
  };

  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader
        title="Product Requests"
        description="Manager applications to add new products and add-ons to the global catalog."
      >
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Pending" value={counts.pending} />
        <StatCard label="Approved" value={counts.approved} />
        <StatCard label="Declined" value={counts.rejected} />
        <StatCard label="Total" value={counts.total} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle>Review Queue</CardTitle>
              <CardDescription>
                Approving creates the product and activates it at the requesting store.
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
                  placeholder="Search product or store…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 w-full sm:w-64"
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
            <p className="text-center text-muted-foreground py-12">No requests in this view.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Store</TableHead>
                    <TableHead className="text-right">Suggested Price</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>When</TableHead>
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
                      </TableCell>
                      <TableCell className="text-sm">{KIND_LABEL[r.requestKind]}</TableCell>
                      <TableCell className="text-sm">{r.storeName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.suggestedPrice ?? 0).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-sm">{r.requestedByName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {toMs(r.createdAt)
                          ? formatDistanceToNow(new Date(toMs(r.createdAt)), { addSuffix: true })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(r.status)}>{STATUS_LABEL[r.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => openReview(r)}>
                          {r.status === "pending" ? "Review" : "View"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ReviewRequestDialog
        request={selected}
        isOpen={!!selected}
        onClose={() => {
          setSelected(null);
          setDuplicateWarning(null);
        }}
        onApprove={handleApprove}
        onDecline={handleDecline}
        isSubmitting={isSubmitting}
        duplicateWarning={duplicateWarning}
      />
    </RoleGuard>
  );
}
