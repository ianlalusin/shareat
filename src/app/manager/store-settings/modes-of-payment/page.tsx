
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ModesOfPaymentRedirectPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/manager/collections');
    }, [router]);

    return null;
}
