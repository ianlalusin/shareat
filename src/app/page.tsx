"use client";

import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "@/lib/firebase/client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { logActivity } from "@/lib/firebase/activity-log";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { AppUser } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [firstName, setFirstName] = useState("there");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      const userDocRef = doc(db, "users", userCredential.user.uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        const appUser = { uid: userCredential.user.uid, ...userDoc.data() } as AppUser;
        await logActivity(appUser, "login", "Logged in");
        const name = appUser.name || appUser.displayName;
        if (name) {
          setFirstName(name.split(" ")[0]);
        }
      }
      setIsRedirecting(true);
      // The redirect is handled by the FirstLoginGuard, this just updates the UI.

    } catch (err: any) {
      const rawError = err?.message ?? "Login failed";
      const cleanedError = rawError.replace("Firebase: ", "");
      setError(cleanedError);
    } finally {
      setLoading(false);
    }
  }

  if (isRedirecting) {
    return (
        <div className="w-full min-h-screen flex items-center justify-center bg-background">
            <Card className="mx-auto max-w-sm w-full">
                <CardHeader className="text-center">
                    <div className="flex justify-center items-center gap-2 mb-4">
                        <Logo className="h-8 w-8 text-destructive" />
                        <h1 className="text-3xl font-bold font-serif text-destructive">SharEat Hub</h1>
                    </div>
                </CardHeader>
                <CardContent className="text-center space-y-4">
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-destructive" />
                    <h2 className="text-xl font-semibold">Logging you in, {firstName}...</h2>
                    <p className="text-muted-foreground">Please wait while we prepare your dashboard.</p>
                </CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex items-center justify-center bg-background">
      <Card className="mx-auto max-w-sm w-full bg-card">
        <CardHeader className="text-center">
            <div className="flex justify-center items-center gap-2 mb-4">
              <Logo className="h-8 w-8 text-destructive" />
              <h1 className="text-3xl font-bold font-serif text-destructive">SharEat Hub</h1>
            </div>
          <CardDescription>
            Enter your credentials to access your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="ml-auto inline-block text-sm underline"
                >
                  Forgot your password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="underline">
              Sign up
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
