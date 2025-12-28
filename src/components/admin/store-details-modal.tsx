
"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Edit, Globe, Mail, Phone, Calendar, Hash, MapPin } from "lucide-react";
import { Store } from "@/app/admin/stores/page";
import { format } from "date-fns";

interface StoreDetailsModalProps {
  store: Store;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (store: Store) => void;
}

export function StoreDetailsModal({ store, isOpen, onClose, onEdit }: StoreDetailsModalProps) {
  if (!store) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <div className="flex items-center gap-4">
                     <div className="p-3 bg-muted rounded-md">
                        <Globe className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="grid gap-1">
                        <DialogTitle className="text-2xl">{store.name}</DialogTitle>
                        <DialogDescription>Store ID: {store.id}</DialogDescription>
                    </div>
                </div>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                     <Badge variant={store.isActive ? 'default' : 'secondary'} className="capitalize">{store.isActive ? 'Active' : 'Inactive'}</Badge>
                </div>
                
                <Separator />

                <div className="grid gap-3">
                    <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Hash /> Store Code</span>
                        <span className="font-medium text-sm">{store.code}</span>
                    </div>
                    <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><MapPin /> Address</span>
                        <span className="font-medium text-sm text-right">{store.address}</span>
                    </div>
                    <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Phone /> Contact No.</span>
                        <span className="font-medium text-sm">{store.contactNumber || 'N/A'}</span>
                    </div>
                    <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Mail /> Email</span>
                        <span className="font-medium text-sm">{store.email || 'N/A'}</span>
                    </div>
                    <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Calendar /> Opening Date</span>
                        <span className="font-medium text-sm">
                            {store.openingDate ? format(store.openingDate.toDate(), 'MMMM dd, yyyy') : 'N/A'}
                        </span>
                    </div>
                </div>
            </div>
            
             <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end w-full">
                <Button variant="secondary" onClick={onClose}>Close</Button>
                <Button variant="outline" onClick={() => onEdit(store)}>
                    <Edit className="mr-2 h-4 w-4" /> Edit
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
  );
}
