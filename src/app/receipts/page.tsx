
"use client";

import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function ReceiptsPage() {

    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <PageHeader
                title="Receipts Center"
                description="Browse, filter, and manage all transactions."
            />
            <div className="mt-8 grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Browse & Print Receipts</CardTitle>
                        <CardDescription>
                            Use the Receipt Settings page to browse all past receipts, filter them, and print or reprint as needed.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button asChild>
                            <Link href="/manager/receipt-settings">
                                Go to Receipt Settings <ArrowRight className="ml-2" />
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>View Sales Reports</CardTitle>
                        <CardDescription>
                            Analyze sales trends, peak hours, and top-selling items on your main dashboard.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button asChild>
                            <Link href="/dashboard">
                                Go to Dashboard <ArrowRight className="ml-2" />
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </RoleGuard>
    );
}
