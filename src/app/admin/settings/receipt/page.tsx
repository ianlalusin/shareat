
'use client'
import { redirect } from 'next/navigation';

export default function DeprecatedReceiptSettingsPage() {
    redirect('/admin/settings');
}
