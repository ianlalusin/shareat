"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function ProductsRedirectPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/admin/menu/products');
    }, [router]);

    return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Redirecting to the new products page...</p>
        </div>
    );
}
