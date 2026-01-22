"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BrandLoader } from "@/components/ui/BrandLoader";

export default function RootPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/login');
    }, [router]);

    return (
        <div className="w-full min-h-screen flex items-center justify-center bg-background">
            <BrandLoader />
        </div>
    );
}
