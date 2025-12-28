

"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { User, Users, Check, Clock, PlusCircle, History, Minus, Plus } from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { QuantityInput } from "../cashier/quantity-input";

export type PendingSession = {
  id: string;
  tableNumber: string;
  packageName: string;
  status: 'pending_verification' | 'active' | 'closed';
  sessionMode: 'package_dinein' | 'alacarte';
  customerName?: string | null;
  isPaid?: boolean;
  packageOfferingId: string;
  initialFlavorIds?: string[];
  startedAt: Timestamp;
  // Guest Count Model
  guestCountCashierInitial: number;
  guestCountServerVerified: number | null;
  guestCountFinal: number | null;
  guestCountVerifyLocked: boolean;
  // Change Request Models
  guestCountChange?: { status: string };
  packageChange?: { status: string };
};


interface PendingTablesProps {
    sessions: PendingSession[];
    onVerify: (session: PendingSession, serverCount: number) => void;
    onRequestChange: (session: PendingSession) => void;
    onViewTimeline: (sessionId: string) => void;
    onAddRefill: (session: PendingSession) => void;
    onAddAddon: (session: PendingSession) => void;
}

const TimeElapsed = ({ startTime }: { startTime: Timestamp | undefined }) => {
    const [elapsed, setElapsed] = useState("0m");

    useEffect(() => {
        if (!startTime) return;

        const updateElapsed = () => {
            const now = Date.now();
            // Firestore Timestamps have a `toMillis` function. JS Dates do not.
            // This handles cases where the timestamp might have been converted.
            const start = typeof (startTime as any).toMillis === 'function' 
                ? (startTime as any).toMillis() 
                : new Date(startTime as any).getTime();

            if (isNaN(start)) {
                console.warn("Invalid startTime prop in TimeElapsed:", startTime);
                return;
            }
            
            const totalMinutes = Math.floor((now - start) / 60000);

            if (totalMinutes < 60) {
                setElapsed(`${totalMinutes}m`);
            } else {
                const hours = Math.floor(totalMinutes / 60);
                const minutes = totalMinutes % 60;
                const paddedMinutes = minutes < 10 ? `0${minutes}` : minutes;
                setElapsed(`${hours}:${paddedMinutes}`);
            }
        };

        const timer = setInterval(updateElapsed, 1000 * 30); // Update every 30 seconds
        updateElapsed(); // Initial calculation

        return () => clearInterval(timer);
    }, [startTime]);

    return (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock size={12} />
            {elapsed}
        </div>
    );
};


function SessionCard({ session, onVerify, onRequestChange, onViewTimeline, onAddRefill, onAddAddon, guestCounts, handleCountChange }: {
    session: PendingSession;
    onVerify: (session: PendingSession, serverCount: number) => void;
    onRequestChange: (session: PendingSession) => void;
    onViewTimeline: (sessionId: string) => void;
    onAddRefill: (session: PendingSession) => void;
    onAddAddon: (session: PendingSession) => void;
    guestCounts: Record<string, number | string>;
    handleCountChange: (sessionId: string, value: string | number) => void;
}) {

     const getVerificationCount = (sessionId: string) => {
        const count = guestCounts[sessionId];
        if (typeof count === 'string') {
            const parsed = parseInt(count, 10);
            return isNaN(parsed) ? 0 : parsed;
        }
        return count || 0;
    }


    const getStatusBadge = (session: PendingSession) => {
      if (session.status === 'active') {
          if (session.guestCountChange?.status === 'pending') {
              return <Badge variant="destructive" className="ml-auto">Guest Change Pending</Badge>
          }
           if (session.packageChange?.status === 'pending') {
              return <Badge variant="destructive" className="ml-auto">Package Change Pending</Badge>
          }
          return <TimeElapsed startTime={session.startedAt} />;
      }
      return <Badge variant="secondary" className="ml-auto">Pending</Badge>
    }
    
    const count = getVerificationCount(session.id);
    
    const cashierCount = Number(session.guestCountCashierInitial ?? 0);
    const guestCount = Number(session.guestCountFinal ?? cashierCount);
    const isLocked = session.status === 'closed' || session.isPaid === true;

    const isAlaCarte = session.sessionMode === 'alacarte';
    const displayLocation = isAlaCarte ? session.customerName || 'Ala Carte' : `Table ${session.tableNumber}`;
    const cardTitle = session.status === 'active' 
        ? (isAlaCarte ? displayLocation : `${displayLocation} - ${guestCount}pax`)
        : displayLocation;

    return (
         <Card key={session.id} className="bg-background">
            <CardHeader className="pb-2 pt-4">
              <div className="flex items-center">
                  <CardTitle className="text-xl">
                      {cardTitle}
                  </CardTitle>
                   <div className="ml-auto flex items-center gap-2">
                        {getStatusBadge(session)}
                    </div>
              </div>
               <p className="font-bold text-base">{session.packageName}</p>
            </CardHeader>
            {session.status === 'pending_verification' && (
                <CardContent className="pt-2 pb-0">
                    <div className="grid grid-cols-2 gap-4 items-end">
                      <div className="space-y-1">
                        <p className="text-sm font-medium flex items-center gap-2 text-muted-foreground"><User /> Cashier</p>
                        <p className="text-2xl font-bold">{cashierCount}</p>
                      </div>
                      <div className="space-y-1">
                          <p className="text-sm font-medium flex items-center gap-2"><Users /> Server</p>
                          <div className="flex items-center gap-1">
                              <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => handleCountChange(session.id, Math.max(0, count - 1))}><Minus /></Button>
                              <QuantityInput
                                  value={count}
                                  onChange={(val) => handleCountChange(session.id, val)}
                                  className="w-full text-center text-lg h-10"
                              />
                              <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => handleCountChange(session.id, count + 1)}><Plus /></Button>
                          </div>
                      </div>
                    </div>
                </CardContent>
            )}
             {session.status === 'active' && <CardContent className="p-0"/>}
            <CardFooter className="flex-col items-stretch space-y-2 pt-2 pb-4">
                <div className="flex gap-2 w-full">
                    {session.status === 'pending_verification' ? (
                        
                            <Button className="w-full" onClick={() => onVerify(session, getVerificationCount(session.id))}>
                                <Check className="mr-2"/> Verify
                            </Button>
                        
                    ) : (
                        <>
                            <Button variant="outline" className="flex-1" onClick={() => onAddRefill(session)} disabled={isLocked}><PlusCircle className="mr-2" /> Refill</Button>
                            <Button variant="outline" className="flex-1" onClick={() => onAddAddon(session)} disabled={isLocked}><PlusCircle className="mr-2" /> Add-on</Button>
                        </>
                    )}
                </div>
                 {session.status === 'active' && (
                    <Button variant="secondary" className="w-full" onClick={() => onRequestChange(session)} disabled={isLocked}>Request Change</Button>
                )}
            </CardFooter>
          </Card>
    )
}

export function PendingTables({ sessions, onVerify, onRequestChange, onViewTimeline, onAddRefill, onAddAddon }: PendingTablesProps) {
  const [guestCounts, setGuestCounts] = useState<Record<string, number | string>>({});

  const pendingVerificationSessions = sessions.filter(s => s.status === 'pending_verification');
  const activeSessions = sessions.filter(s => s.status === 'active');

  // Effect to initialize counts when sessions load or change
  useEffect(() => {
    const initialCounts: Record<string, number | string> = {};
    sessions.forEach(session => {
        // Only initialize if not already set by the user
        const cashierCount = Number(session.guestCountCashierInitial ?? 0);
        if (session.status === 'pending_verification' && guestCounts[session.id] === undefined) {
            initialCounts[session.id] = cashierCount;
        }
    });
    // Merge initial counts without overwriting existing (edited) counts
    if (Object.keys(initialCounts).length > 0) {
        setGuestCounts(prev => ({...initialCounts, ...prev}));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);


  const handleCountChange = (sessionId: string, value: string | number) => {
    setGuestCounts(prev => ({
      ...prev,
      [sessionId]: value
    }));
  };
  
  return (
    <div className="space-y-4">
        <Accordion type="single" collapsible defaultValue="pending" className="w-full">
            <AccordionItem value="pending">
                 <Card>
                    <CardHeader className="p-0">
                         <AccordionTrigger className="flex items-center gap-4 p-6">
                            <div className="text-left">
                                <CardTitle>Pending Verification</CardTitle>
                                <CardDescription>Sessions waiting for server confirmation.</CardDescription>
                            </div>
                            <Badge variant="destructive">{pendingVerificationSessions.length}</Badge>
                         </AccordionTrigger>
                    </CardHeader>
                    <AccordionContent>
                        <CardContent className="grid sm:grid-cols-2 gap-4 pt-4">
                            {pendingVerificationSessions.length === 0 ? <p className="text-muted-foreground text-center py-4 sm:col-span-2">No sessions are waiting for verification.</p> : null}
                            {pendingVerificationSessions.map(session => (
                                <SessionCard
                                    key={session.id}
                                    session={session}
                                    onVerify={onVerify}
                                    onRequestChange={onRequestChange}
                                    onViewTimeline={onViewTimeline}
                                    onAddRefill={onAddRefill}
                                    onAddAddon={onAddAddon}
                                    guestCounts={guestCounts}
                                    handleCountChange={handleCountChange}
                                />
                            ))}
                        </CardContent>
                    </AccordionContent>
                 </Card>
            </AccordionItem>
        </Accordion>

        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle>Active Sessions</CardTitle>
                    <Badge variant="secondary">{activeSessions.length}</Badge>
                </div>
                <CardDescription>Verified sessions that are currently ongoing.</CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4">
                {activeSessions.length === 0 ? <p className="text-muted-foreground text-center py-4 sm:col-span-2">No active sessions.</p> : null}
                {activeSessions.map(session => (
                     <SessionCard
                        key={session.id}
                        session={session}
                        onVerify={onVerify}
                        onRequestChange={onRequestChange}
                        onViewTimeline={onViewTimeline}
                        onAddRefill={onAddRefill}
                        onAddAddon={onAddAddon}
                        guestCounts={guestCounts}
                        handleCountChange={handleCountChange}
                    />
                ))}
            </CardContent>
        </Card>
    </div>
  );
}
