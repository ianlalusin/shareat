
"use client";

import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Image from "next/image";

export default function PendingPage() {
  const router = useRouter();

  async function handleLogout() {
    await signOut(auth);
    router.replace("/");
  }

  return (
    <div className="w-full min-h-screen flex items-center justify-center bg-background">
       <Card className="mx-auto max-w-md w-full">
         <CardHeader className="text-center">
           <div className="flex flex-col justify-center items-center gap-4 mb-4">
            <div className="relative h-32 w-32">
              <Image 
                src="/logo.png"
                alt="SharEat"
                fill
                priority
                className="object-contain"
              />
            </div>
            <h1 className="text-3xl font-bold font-serif text-destructive">SharEat Hub</h1>
           </div>
          <CardTitle className="text-xl">Account Creation Successful</CardTitle>
          <CardDescription>
            Your account is currently <span className="font-medium text-primary">Pending Approval</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
           <p className="mb-6 text-center text-sm text-muted-foreground">
            You will be able to access the system once an administrator approves your account.
            You can log out and check back later.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button className="w-full" onClick={handleLogout}>
              Logout
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              onClick={() => router.push("/support")}
            >
              Contact Support
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
