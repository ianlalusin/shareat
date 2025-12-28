
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import { AddonsPOSModal } from "./AddonsPOSModal";
import type { PendingSession } from "../server/pending-tables";

interface AddonsLauncherButtonProps {
  storeId: string;
  session: PendingSession;
  sessionIsLocked?: boolean;
}

export function AddonsLauncherButton({ storeId, session, sessionIsLocked }: AddonsLauncherButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" disabled={sessionIsLocked} onClick={() => setIsModalOpen(true)}>
          <PlusCircle className="mr-2"/> Add Item
      </Button>
      
      {isModalOpen && (
        <AddonsPOSModal
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          storeId={storeId}
          session={session}
          sessionIsLocked={sessionIsLocked}
        />
      )}
    </>
  );
}
