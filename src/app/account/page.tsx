
"use client";

import { useAuthContext } from "@/context/auth-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ImageIcon, Loader2, UploadCloud, View } from "lucide-react";
import { uploadUserAvatar } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { subscribeToUserActivity, logActivity } from "@/lib/firebase/activity-log";
import { format } from 'date-fns';
import { RoleGuard } from "@/components/guards/RoleGuard";

export default function AccountPage() {
    const { appUser, loading } = useAuthContext();
    const router = useRouter();
    const { toast } = useToast();
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isAvatarDialogOpen, setIsAvatarDialogOpen] = useState(false);
    const [activities, setActivities] = useState<any[]>([]);

    useEffect(() => {
        if (!loading && !appUser) {
            router.push('/');
        }
    }, [appUser, loading, router]);

    useEffect(() => {
        if (appUser?.uid) {
            const unsubscribe = subscribeToUserActivity(appUser.uid, setActivities, 20);
            return () => unsubscribe();
        }
    }, [appUser?.uid]);


    if (loading || !appUser) {
        return <div className="flex items-center justify-center h-full">Loading...</div>;
    }

    const user = appUser;

    const userInitials = user.displayName
        ? user.displayName.split(' ').map(n => n[0]).join('')
        : user.email ? user.email[0].toUpperCase() : 'U';

    const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !user) return;

        setIsUploading(true);
        try {
            await uploadUserAvatar(user.uid, file);
            await logActivity(user, "profile_photo_update", "Updated profile photo");
            toast({
                title: "Profile photo updated",
                description: "Your new avatar has been saved.",
            });
        } catch (error) {
            console.error("Failed to upload avatar:", error);
            toast({
                variant: "destructive",
                title: "Upload failed",
                description: "Could not update your profile photo.",
            });
        } finally {
            setIsUploading(false);
            setIsAvatarDialogOpen(false); 
        }
    };

    return (
        <RoleGuard allow={["admin", "manager", "cashier", "kitchen", "server"]}>
            <PageHeader title="My Account" description="View and manage your account details." />
            <div className="grid gap-8 md:grid-cols-3">
                <div className="md:col-span-1">
                    <Card>
                        <CardHeader className="flex flex-col items-center text-center p-6">
                             <Dialog open={isAvatarDialogOpen} onOpenChange={setIsAvatarDialogOpen}>
                                <DialogTrigger asChild>
                                    <button className="relative rounded-full">
                                        <Avatar className="h-24 w-24 mb-4 cursor-pointer ring-2 ring-offset-2 ring-transparent hover:ring-primary transition-all">
                                            <AvatarImage src={user.photoURL || undefined} alt={user.displayName || 'User'} />
                                            <AvatarFallback className="text-3xl">{userInitials}</AvatarFallback>
                                        </Avatar>
                                         <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                            <ImageIcon className="h-8 w-8 text-white" />
                                        </div>
                                    </button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Profile Photo</DialogTitle>
                                        <DialogDescription>Manage your avatar.</DialogDescription>
                                    </DialogHeader>
                                    <div className="flex justify-center py-4">
                                        <Avatar className="h-40 w-40">
                                            <AvatarImage src={user.photoURL || undefined} alt={user.displayName || 'User'}/>
                                            <AvatarFallback className="text-6xl">{userInitials}</AvatarFallback>
                                        </Avatar>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <Button variant="outline" asChild disabled={!user.photoURL}>
                                            <a href={user.photoURL!} target="_blank" rel="noopener noreferrer">
                                                <View className="mr-2" /> View Photo
                                            </a>
                                        </Button>
                                        <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                                            {isUploading ? (
                                                <Loader2 className="mr-2 animate-spin" />
                                            ) : (
                                                <UploadCloud className="mr-2" />
                                            )}
                                            Upload New
                                        </Button>
                                    </div>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleAvatarUpload}
                                        className="hidden"
                                        accept="image/*"
                                    />
                                </DialogContent>
                            </Dialog>
                            <CardTitle className="text-xl">{user.displayName}</CardTitle>
                            <CardDescription>{user.email}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Separator />
                            <div className="py-4 grid gap-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground text-sm">Role</span>
                                    <Badge variant="outline" className="capitalize">{user.role}</Badge>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground text-sm">Store ID</span>
                                    <span className="font-medium text-sm">{user.storeId || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground text-sm">Status</span>
                                     <Badge variant={user.status === 'active' ? 'default' : 'secondary'} className="capitalize">{user.status}</Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Activity Log</CardTitle>
                            <CardDescription>A log of your recent account activity.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {activities.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Time</TableHead>
                                            <TableHead>Description</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {activities.map((activity) => (
                                            <TableRow key={activity.id}>
                                                <TableCell className="text-muted-foreground">
                                                     {format(activity.createdAt, 'MM/dd/yyyy')}
                                                </TableCell>
                                                <TableCell>{activity.description}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <p className="text-center text-muted-foreground py-8">No recent activity.</p>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </RoleGuard>
    );
}
