
"use client";

import { AppUser } from "@/context/auth-context";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, ChevronsUpDown, Edit, Save, Trash2, XCircle, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { UserRole } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command";
import { cn } from "@/lib/utils";

export type StoreOption = { id: string; name: string; };

interface UserDetailsModalProps {
  user: AppUser;
  isOpen: boolean;
  onClose: () => void;
  currentUserRole?: 'admin' | 'manager' | 'cashier' | 'kitchen' | 'server' | 'pending';
  currentUserId?: string;
  availableStores: StoreOption[];
  onDeactivate: (user: AppUser) => void;
  onReactivate: (user: AppUser) => void;
  onDelete: (uid: string, name?: string) => void;
  onUpdate: (uid: string, data: Partial<AppUser>) => Promise<void>;
  isProcessing?: boolean;
}

const roles: UserRole[] = ['admin', 'manager', 'cashier', 'kitchen', 'server'];

export function UserDetailsModal({ user, isOpen, onClose, currentUserRole, currentUserId, availableStores, onDeactivate, onReactivate, onDelete, onUpdate, isProcessing }: UserDetailsModalProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editableUser, setEditableUser] = useState<Partial<AppUser>>({});

    useEffect(() => {
        if (user) {
            setEditableUser({
                name: user.name,
                contactNumber: user.contactNumber,
                address: user.address,
                role: user.role,
                storeId: user.storeId,
                assignedStoreIds: user.assignedStoreIds || [],
            });
        }
        setIsEditing(false);
    }, [user, isOpen]);

    const userInitials = user.name
        ? user.name.split(' ').map(n => n[0]).join('')
        : user.email ? user.email[0].toUpperCase() : 'U';

    if (!user) return null;

    const isAdmin = currentUserRole === 'admin';
    const isSelf = user.uid === currentUserId;
    const isDeactivated = user.status === 'disabled';

    const handleSave = async () => {
        const updatedData: Partial<AppUser> = { ...editableUser };
        const assigned = updatedData.assignedStoreIds || [];
        
        // If the current active storeId is no longer in the assigned list,
        // or if there is no active storeId but there are assigned stores,
        // set the active store to the first one in the assigned list.
        if ((updatedData.storeId && !assigned.includes(updatedData.storeId)) || (!updatedData.storeId && assigned.length > 0)) {
            updatedData.storeId = assigned[0] || null;
        }

        await onUpdate(user.uid, updatedData);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setEditableUser({
            name: user.name,
            contactNumber: user.contactNumber,
            address: user.address,
            role: user.role,
            storeId: user.storeId,
            assignedStoreIds: user.assignedStoreIds || [],
        });
        setIsEditing(false);
    };

    const handleInputChange = (field: keyof AppUser, value: string) => {
        setEditableUser(prev => ({...prev, [field]: value}));
    };
    
    const handleRoleChange = (value: UserRole) => {
        setEditableUser(prev => ({...prev, role: value, roles: [value] }));
    };

    const handleStoreAssignmentChange = (storeId: string) => {
        setEditableUser(prev => {
            const current = prev.assignedStoreIds || [];
            const newAssignments = current.includes(storeId)
                ? current.filter(id => id !== storeId)
                : [...current, storeId];
            return {...prev, assignedStoreIds: newAssignments};
        });
    }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <DialogHeader>
                <div className="flex items-center gap-4">
                     <Avatar className="h-16 w-16">
                        <AvatarImage src={user.photoURL || undefined} alt={user.name || 'User'} />
                        <AvatarFallback className="text-xl">{userInitials}</AvatarFallback>
                    </Avatar>
                    {isEditing ? (
                         <div className="grid gap-1.5 w-full">
                            <Label htmlFor="name" className="sr-only">Full Name</Label>
                            <Input id="name" value={editableUser.name || ''} onChange={(e) => handleInputChange('name', e.target.value)} className="text-2xl font-semibold leading-none tracking-tight" />
                            <DialogDescription>{user.email}</DialogDescription>
                        </div>
                    ) : (
                        <div className="grid gap-1 min-w-0">
                            <DialogTitle className="text-2xl break-words">{user.name}</DialogTitle>
                            <DialogDescription className="break-words">{user.email}</DialogDescription>
                        </div>
                    )}
                </div>
            </DialogHeader>
            
             <div className="grid gap-4 py-4">
                <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
                    <div className="text-sm text-muted-foreground">Status</div>
                    <Badge variant={user.status === 'active' ? 'default' : user.status === 'disabled' ? 'destructive' : 'secondary'} className="capitalize justify-self-start">{user.status}</Badge>
                </div>
                
                {isEditing ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-[120px_1fr] items-center gap-3">
                            <Label className="text-sm text-muted-foreground">Role</Label>
                            <Select
                                value={editableUser.role}
                                onValueChange={handleRoleChange}
                                disabled={!isAdmin || isSelf}
                            >
                                <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select a role" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roles.map(role => (
                                        <SelectItem key={role} value={role} className="capitalize">{role}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-3">
                            <Label htmlFor="contactNumber" className="text-sm text-muted-foreground">Contact</Label>
                            <Input id="contactNumber" value={editableUser.contactNumber || ''} onChange={(e) => handleInputChange('contactNumber', e.target.value)} className="h-9" />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-center gap-3">
                            <Label htmlFor="address" className="text-sm text-muted-foreground">Address</Label>
                            <Input id="address" value={editableUser.address || ''} onChange={(e) => handleInputChange('address', e.target.value)} className="h-9" />
                        </div>
                        <div className="grid grid-cols-[120px_1fr] items-start gap-3 pt-1">
                            <Label className="text-sm text-muted-foreground pt-2">Stores</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" role="combobox" className="h-auto justify-between flex-wrap" disabled={!isEditing || !isAdmin}>
                                        <span className="truncate">
                                            {editableUser.assignedStoreIds?.length || 0} selected
                                        </span>
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                  portal={false}
                                  side="bottom"
                                  align="start"
                                  sideOffset={8}
                                  className="w-[250px] p-0 z-[9999] pointer-events-auto"
                                >
                                    <Command>
                                        <CommandInput placeholder="Search store..." />
                                        <CommandList>
                                            <CommandEmpty>No stores found.</CommandEmpty>
                                            <CommandGroup>
                                                {availableStores.map((store) => (
                                                    <CommandItem
                                                      key={store.id}
                                                      value={store.id}
                                                      onSelect={(value) => handleStoreAssignmentChange(value)}
                                                    >                                                  
                                                        <Check className={cn("mr-2 h-4 w-4", editableUser.assignedStoreIds?.includes(store.id) ? "opacity-100" : "opacity-0")} />
                                                        {store.name}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                ) : (
                     <div className="space-y-3">
                        <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
                            <div className="text-sm text-muted-foreground">Role</div>
                            <div className="text-sm font-medium capitalize">{user.role || 'Not Assigned'}</div>
                        </div>
                         <div className="grid grid-cols-[120px_1fr] gap-3 items-center">
                            <div className="text-sm text-muted-foreground">Contact</div>
                            <div className="text-sm font-medium break-words min-w-0">{user.contactNumber || 'N/A'}</div>
                        </div>
                         <div className="grid grid-cols-[120px_1fr] gap-3 items-start">
                            <div className="text-sm text-muted-foreground">Address</div>
                            <div className="text-sm font-medium break-words min-w-0">{user.address || 'N/A'}</div>
                        </div>
                        <div className="grid grid-cols-[120px_1fr] gap-3 items-start">
                            <div className="text-sm text-muted-foreground">Assigned Stores</div>
                             <div className="flex flex-wrap gap-1">
                                {(user.assignedStoreIds || []).length > 0 ? (
                                    user.assignedStoreIds?.map(id => (
                                        <Badge key={id} variant="secondary">{availableStores.find(s=>s.id === id)?.name || id}</Badge>
                                    ))
                                ) : (
                                    <span className="text-sm font-medium">None</span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <Separator />
            
             <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between w-full">
                {isEditing ? (
                    <div className="flex justify-end gap-2 w-full">
                        <Button variant="ghost" onClick={handleCancel} disabled={isProcessing}>Cancel</Button>
                        <Button onClick={handleSave} disabled={isProcessing}>
                            {isProcessing ? 'Saving...' : <><Save className="mr-2 h-4 w-4" /> Save Changes</>}
                        </Button>
                    </div>
                ) : (
                     <div className="flex justify-between items-center w-full">
                        <div className="flex gap-2">
                             {!isSelf && currentUserRole === 'admin' && (
                                <>
                                    {isDeactivated ? (
                                         <Button 
                                            variant="outline"
                                            onClick={() => onReactivate(user)}
                                            disabled={isProcessing}
                                        >
                                            <RotateCw className="mr-2 h-4 w-4" /> Reactivate
                                        </Button>
                                    ) : (
                                         <Button 
                                            variant="destructive"
                                            onClick={() => onDeactivate(user)}
                                            disabled={isProcessing}
                                        >
                                            <XCircle className="mr-2 h-4 w-4" /> Deactivate
                                        </Button>
                                    )}
                                    <Button 
                                        variant="destructive" 
                                        onClick={() => onDelete(user.uid, user.name)}
                                        disabled={isProcessing}
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </Button>
                                </>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setIsEditing(true)}>
                                <Edit className="mr-2 h-4 w-4" /> Edit
                            </Button>
                            <Button variant="secondary" onClick={onClose}>Close</Button>
                        </div>
                    </div>
                )}
            </DialogFooter>
        </DialogContent>
    </Dialog>
  );
}
