
'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check } from 'lucide-react';
import { useSuccessModal } from '@/store/use-success-modal';

export function SuccessConfirm() {
  const { isSuccessModalOpen, closeSuccessModal } = useSuccessModal();

  React.useEffect(() => {
    if (isSuccessModalOpen) {
      const timer = setTimeout(() => {
        closeSuccessModal();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isSuccessModalOpen, closeSuccessModal]);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      closeSuccessModal();
    }
  };

  return (
    <Dialog open={isSuccessModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xs p-8 bg-background/90 backdrop-blur-sm border-none shadow-2xl">
        <DialogHeader>
            <DialogTitle className="sr-only">Success</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="relative h-20 w-20">
            <div className="absolute inset-0 bg-green-500 rounded-full animate-ping-slow opacity-30" />
            <div className="relative flex h-full w-full items-center justify-center rounded-full bg-green-500">
              <Check className="h-10 w-10 text-white" strokeWidth={3} />
            </div>
          </div>
          <p className="text-lg font-semibold text-foreground">Action Success</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
