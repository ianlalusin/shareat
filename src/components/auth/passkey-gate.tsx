
"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useFirestore } from "@/firebase";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type AuthGateConfig = {
  isEnabled?: boolean;
  passkey?: string;
};

export function PasskeyGate({ children }: { children: React.ReactNode }) {
  const firestore = useFirestore();
  const [status, setStatus] = useState<"checking" | "locked" | "unlocked">("checking");
  const [expectedPasskey, setExpectedPasskey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firestore) return;

    // If this browser already passed the gate, skip
    if (typeof window !== "undefined") {
      const ok = window.localStorage.getItem("se_access_ok");
      if (ok === "1") {
        setStatus("unlocked");
        return;
      }
    }

    const load = async () => {
      const ref = doc(firestore, "appSettings", "authGate");
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        // No gate configured → allow access
        setStatus("unlocked");
        return;
      }

      const data = snap.data() as AuthGateConfig;
      if (!data.isEnabled || !data.passkey) {
        setStatus("unlocked");
        return;
      }

      setExpectedPasskey(data.passkey);
      setStatus("locked");
    };

    load();
  }, [firestore]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expectedPasskey) return;

    if (input === expectedPasskey) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("se_access_ok", "1");
      }
      setStatus("unlocked");
    } else {
      setError("Incorrect access code. Please try again.");
    }
  };

  if (status === "unlocked") return <>{children}</>;

  if (status === "checking") {
    return (
      <div className="flex min-h-svh w-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Preparing sign-in…</p>
      </div>
    );
  }

  // Locked state: show passkey screen
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Enter access code</CardTitle>
          <CardDescription>
            Only staff who know this 6-digit code can log in or sign up.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError("");
                }}
                placeholder="••••••"
                className="tracking-[0.3em] text-center"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
