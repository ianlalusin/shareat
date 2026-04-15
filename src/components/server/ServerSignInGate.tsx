"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogIn, UserCircle2 } from "lucide-react";
import { ServerProfileSwitcher } from "./ServerProfileSwitcher";

interface Props {
  storeId: string;
  onSignIn: (profileId: string, name: string) => void;
}

export function ServerSignInGate({ storeId, onSignIn }: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false);

  useEffect(() => {
    setSwitcherOpen(true);
  }, []);

  return (
    <div className="flex items-center justify-center py-12">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <UserCircle2 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>Sign in as server</CardTitle>
          <CardDescription>
            Identify yourself on this tablet before opening the server station. Your actions are attributed by name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="lg" className="w-full" onClick={() => setSwitcherOpen(true)}>
            <LogIn className="h-4 w-4 mr-2" /> Sign in
          </Button>
        </CardContent>
      </Card>

      <ServerProfileSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        storeId={storeId}
        currentProfileId={null}
        onSignIn={onSignIn}
        onSignOut={() => {}}
      />
    </div>
  );
}
