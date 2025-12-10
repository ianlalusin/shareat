
'use client'
import { redirect } from 'next/navigation';

export default function DeprecatedGListPage() {
    redirect('/admin/global-collections');
}
