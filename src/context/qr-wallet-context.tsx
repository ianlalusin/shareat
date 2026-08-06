"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { addDoc, collection } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { useAuthContext } from "@/context/auth-context";
import { useLocalProfile } from "@/context/local-profile-context";
import { QrWalletModal } from "@/components/qr-wallet/QrWalletModal";
import { AddQrDialog } from "@/components/qr-wallet/AddQrDialog";
import type { SavedQrCode } from "@/lib/types";

interface QrWalletContextValue {
  /** Opens the wallet. Safe to call from anywhere in the app. */
  openWallet: () => void;
}

const QrWalletContext = createContext<QrWalletContextValue | null>(null);

/**
 * Holds the QR wallet's open state and mounts its dialogs ONCE, so the navbar
 * (desktop and mobile) can open the same instance. Mirrors LocalProfileProvider.
 *
 * Mounting once matters here: the mobile trigger lives inside the nav Sheet, and
 * a per-trigger dialog would portal a second copy on top of the first.
 */
export function QrWalletProvider({ children }: { children: React.ReactNode }) {
  const { activeStoreId } = useStoreContext();
  const { appUser } = useAuthContext();
  const { currentProfile } = useLocalProfile();

  const [walletOpen, setWalletOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [editing, setEditing] = useState<SavedQrCode | null>(null);

  const openWallet = useCallback(() => setWalletOpen(true), []);

  const handleManage = useCallback((qr: SavedQrCode | null) => {
    setEditing(qr);
    setManageOpen(true);
  }, []);

  /**
   * Audit trail. Feature A records no tender, so a displayed QR is the only
   * trace that money may have moved outside the POS.
   *
   * Fire-and-forget on purpose: a failed audit write must never stop a cashier
   * showing a customer the QR. Uses its own collection rather than
   * writeActivityLog, which hard-requires a sessionId and takes a closed union
   * of action names.
   */
  const handleDisplay = useCallback(
    (qr: SavedQrCode) => {
      if (!activeStoreId) return;
      void addDoc(collection(db, "stores", activeStoreId, "qrWalletEvents"), {
        qrId: qr.id,
        qrName: qr.name,
        provider: qr.provider ?? "generic",
        sessionId: null,
        createdAtMs: Date.now(),
        createdByUid: appUser?.uid ?? "",
        createdByLocalUserId: currentProfile?.profileId ?? null,
      }).catch((error) => {
        console.warn("[qr-wallet] audit write failed:", error);
      });
    },
    [activeStoreId, appUser?.uid, currentProfile?.profileId],
  );

  const value = useMemo<QrWalletContextValue>(() => ({ openWallet }), [openWallet]);

  return (
    <QrWalletContext.Provider value={value}>
      {children}
      <QrWalletModal
        open={walletOpen}
        onOpenChange={setWalletOpen}
        storeId={activeStoreId}
        onManage={handleManage}
        onDisplay={handleDisplay}
      />
      {activeStoreId && manageOpen && (
        <AddQrDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          storeId={activeStoreId}
          editing={editing}
        />
      )}
    </QrWalletContext.Provider>
  );
}

export function useQrWallet(): QrWalletContextValue {
  const ctx = useContext(QrWalletContext);
  if (!ctx) throw new Error("useQrWallet must be used within a QrWalletProvider");
  return ctx;
}
