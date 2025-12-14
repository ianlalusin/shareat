
"use client";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function PendingApprovalPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md p-6 text-center">
        <CardHeader>
            <CardTitle>Account pending approval</CardTitle>
            <CardDescription className="space-y-3 pt-2">
                <span>
                Your access request has been submitted. Please inform your manager so
                they can approve it in the admin panel.
                </span>
                <span className="block text-xs">
                Once approved, you’ll be able to sign in normally using this email.
                </span>
            </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
