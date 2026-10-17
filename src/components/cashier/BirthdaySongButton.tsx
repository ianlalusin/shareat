'use client';

import { useEffect, useState } from 'react';
import { Cake, Play, Square, Volume2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { playBirthdayLoop, stopAll } from '@/lib/birthday/player';

const TRACK_NAMES = ['SharEat birthday song', 'Happy Birthday'];

/** Floating speaker badge on the cashier session list: plays the birthday songs on a loop. */
export function BirthdaySongButton() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState<number | null>(null);

  useEffect(() => () => stopAll(), []);

  const playing = track !== null;

  const handlePlay = async () => {
    try {
      await playBirthdayLoop(setTrack);
    } catch (e) {
      setTrack(null);
      toast({ variant: 'destructive', title: 'Could not play', description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleStop = () => {
    stopAll();
    setTrack(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) handleStop();
    setOpen(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-44 right-6 z-40 h-14 w-14 rounded-full bg-pink-500 text-white shadow-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform ring-4 ring-pink-500/20"
        aria-label="Birthday song"
      >
        <Volume2 className="h-6 w-6" />
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Cake className="h-5 w-5" /> Birthday song</DialogTitle>
            <DialogDescription>
              Plays the SharEat birthday song, then Happy Birthday, over and over until you press Stop.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {playing ? (
              <>
                <p className="text-sm text-center">Now playing: <span className="font-semibold">{TRACK_NAMES[track] ?? ''}</span></p>
                <Button className="w-full" variant="destructive" onClick={handleStop}>
                  <Square className="mr-2 h-4 w-4" /> Stop
                </Button>
              </>
            ) : (
              <Button className="w-full" onClick={handlePlay}>
                <Play className="mr-2 h-4 w-4" /> Play birthday songs
              </Button>
            )}
            <p className="text-xs text-muted-foreground">Music playing on this tablet pauses while the song plays. Closing this box stops the song.</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
