

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHead,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PlusCircle, MoreHorizontal, User, Lock } from 'lucide-react';
import { Staff } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuthContext } from '@/context/auth-context';
import { Card } from '@/components/ui/card';
import { isAdmin } from '@/lib/scope';

function AccessModal({ staff, isOpen, onClose }: { staff: Staff | null; isOpen: boolean; onClose: () => void; }) {
  if (!staff) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
            <div className="flex items-start justify-between gap-2">
                <DialogTitle>Access Control for {staff.fullName}</DialogTitle>
                <Badge variant="secondary">{staff.position}</Badge>
            </div>
            <DialogDescription>
                Controls what this staff member can see and do in the system.
            </DialogDescription>
        </DialogHeader>
        <div className="py-4">
            <p className="text-sm text-muted-foreground">
                Detailed permission settings for this role will be managed here in the future. This will control access to specific pages and actions, like editing receipts.
            </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}


export default function StaffPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaffForAccess, setSelectedStaffForAccess] = useState<Staff | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();
  const { appUser, devMode } = useAuthContext();
  const canDelete = devMode || appUser?.role === 'admin';

  useEffect(() => {
    if (!firestore || !appUser) return;
    
    let staffQuery;
    const staffCollection = collection(firestore, 'staff');
    
    if (isAdmin(appUser)) {
      staffQuery = query(staffCollection);
    } else if (appUser.activeStoreId) {
      staffQuery = query(staffCollection, where('storeIds', 'array-contains', appUser.activeStoreId));
    } else {
      setStaff([]);
      return;
    }

    const unsubscribe = onSnapshot(staffQuery, (snapshot) => {
      const staffData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Staff[];
      setStaff(staffData);
    });
    return () => unsubscribe();
  }, [firestore, appUser]);

  const handleDelete = async () => {
    if (!firestore || !deleteTargetId) return;
    try {
      await deleteDoc(doc(firestore, 'staff', deleteTargetId));
       toast({
        title: "Success!",
        description: "The staff member has been deleted.",
      });
    } catch (error) {
      console.error('Error deleting document: ', error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: "Could not delete staff member. Please try again.",
      });
    } finally {
      setDeleteTargetId(null);
    }
  };

  const handleRowClick = (staffId: string) => {
    router.push(`/admin/staff/${staffId}`);
  };

  return (
    <>
      <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold md:text-2xl font-headline">
            Staff Management
          </h1>
          <Button size="sm" className="flex items-center gap-2" asChild>
            <Link href="/admin/staff/new">
              <PlusCircle className="h-4 w-4" />
              <span>Add Staff</span>
            </Link>
          </Button>
        </div>
        
        {/* Desktop Table View */}
        <div className="rounded-lg border shadow-sm bg-background hidden md:block">
          <ScrollArea className="w-full max-w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Default Store</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Employment Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((member) => (
                  <TableRow
                    key={member.id}
                    onClick={() => handleRowClick(member.id)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={member.picture} alt={member.fullName} />
                          <AvatarFallback>
                            <User />
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{member.fullName}</div>
                          <div className="text-sm text-muted-foreground">{member.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{member.assignedStore}</TableCell>
                    <TableCell>{member.position}</TableCell>
                    <TableCell>
                      <Badge variant={member.employmentStatus === 'Active' ? 'default' : 'secondary'} 
                        className={member.employmentStatus === 'Active' ? 'bg-green-500' : ''}>
                        {member.employmentStatus}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button aria-haspopup="true" size="icon" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onSelect={() => router.push(`/admin/staff/${member.id}/edit`)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setSelectedStaffForAccess(member)}>
                            Access
                          </DropdownMenuItem>
                          {canDelete && (
                            <DropdownMenuItem
                              onSelect={() => setDeleteTargetId(member.id)}
                              className="text-destructive"
                            >
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
        
        {/* Mobile Card View */}
        <div className="md:hidden space-y-3">
          {staff.map((member) => (
            <Card key={member.id} onClick={() => handleRowClick(member.id)} className="p-4">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                   <Avatar className="h-10 w-10">
                      <AvatarImage src={member.picture} alt={member.fullName} />
                      <AvatarFallback><User /></AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-semibold">{member.fullName}</div>
                      <div className="text-xs text-muted-foreground">{member.position}</div>
                    </div>
                </div>
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost" onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Toggle menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                       <DropdownMenuLabel>Actions</DropdownMenuLabel>
                       <DropdownMenuItem onSelect={() => router.push(`/admin/staff/${member.id}/edit`)}>Edit</DropdownMenuItem>
                       <DropdownMenuItem onSelect={() => setSelectedStaffForAccess(member)}>Access</DropdownMenuItem>
                       {canDelete && (
                        <DropdownMenuItem onSelect={() => setDeleteTargetId(member.id)} className="text-destructive">Delete</DropdownMenuItem>
                       )}
                    </DropdownMenuContent>
                  </DropdownMenu>
              </div>
              <div className="mt-3 pt-3 border-t text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Store:</span>
                  <span>{member.assignedStore}</span>
                </div>
                 <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={member.employmentStatus === 'Active' ? 'default' : 'secondary'} className={member.employmentStatus === 'Active' ? 'bg-green-500' : ''}>
                    {member.employmentStatus}
                  </Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </main>
      <AccessModal 
        isOpen={!!selectedStaffForAccess}
        onClose={() => setSelectedStaffForAccess(null)}
        staff={selectedStaffForAccess}
      />
      <AlertDialog
        open={!!deleteTargetId}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Staff Member?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The staff member's record will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
