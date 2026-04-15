"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Repeat, UserCircle2 } from "lucide-react";
import { ServerProfileSwitcher } from "./ServerProfileSwitcher";

interface Props {
  storeId: string;
  profileId: string;
  name: string;
  onSignIn: (profileId: string, name: string) => void;
  onSignOut: () => void;
}

export function ServerUserCard({ storeId, profileId, name, onSignIn, onSignOut }: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <>
      <Card>
        <CardContent className="p-2 pl-3 flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <UserCircle2 className="h-5 w-5" />
          </div>
          <div className="leading-tight pr-1 min-w-0">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">Signed in</p>
            <p className="text-sm font-bold truncate max-w-[140px]">{name}</p>
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setSwitcherOpen(true)}>
            <Repeat className="h-3.5 w-3.5 mr-1" /> Switch
          </Button>
        </CardContent>
      </Card>

      <ServerProfileSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        storeId={storeId}
        currentProfileId={profileId}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
      />
    </>
  );
}
