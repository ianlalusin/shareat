"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogIn, UserCircle2 } from "lucide-react";
import { ServerProfileSwitcher } from "./ServerProfileSwitcher";

interface Props {
  storeId: string;
  onSignIn: (profileId: string, name: string) => void;
  /** UI copy. Defaults to the server-station wording. */
  title?: string;
  description?: string;
  /** Convenience: e.g. "kitchen display" → "Sign in to the kitchen display". Ignored if `title` is set. */
  roleLabel?: string;
}

export function ServerSignInGate({ storeId, onSignIn, title, description, roleLabel }: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false);

  useEffect(() => {
    setSwitcherOpen(true);
  }, []);

  const resolvedTitle = title ?? (roleLabel ? `Sign in to the ${roleLabel}` : "Sign in as server");
  const resolvedDescription =
    description ??
    `Identify yourself on this tablet before opening the ${roleLabel ?? "server station"}. Your actions are attributed by name.`;

  return (
    <div className="flex items-center justify-center py-12">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <UserCircle2 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle>{resolvedTitle}</CardTitle>
          <CardDescription>
            {resolvedDescription}
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
