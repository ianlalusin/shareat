

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
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

function AccessModal({ staff, isOpen, onClose }: { staff: Staff | null; isOpen: boolean; onClose: () => void; }) {
  if (!staff) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
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
  const firestore = useFirestore();
  const router = useRouter();

  useEffect(() => {
    if (firestore) {
      const unsubscribe = onSnapshot(collection(firestore, 'staff'), (snapshot) => {
        const staffData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Staff[];
        setStaff(staffData);
      });
      return () => unsubscribe();
    }
  }, [firestore]);

  const handleDelete = async (staffId: string) => {
    if (!firestore) return;
    try {
      await deleteDoc(doc(firestore, 'staff', staffId));
    } catch (error) {
      console.error('Error deleting document: ', error);
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
        <div className="rounded-lg border shadow-sm bg-background">
          <ScrollArea className="w-full max-w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Assigned Store</TableHead>
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
                          <DropdownMenuItem
                            onSelect={() => handleDelete(member.id)}
                            className="text-destructive"
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </main>
      <AccessModal 
        isOpen={!!selectedStaffForAccess}
        onClose={() => setSelectedStaffForAccess(null)}
        staff={selectedStaffForAccess}
      />
    </>
  );
}
