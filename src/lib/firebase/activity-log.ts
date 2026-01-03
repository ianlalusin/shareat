
"use client";

// This is a placeholder file to prevent build errors.
// The activity logging feature was removed, but some components still import it.
// These no-op functions ensure the app compiles while doing nothing.

export async function logActivity(..._args: any[]): Promise<void> {
  // Do nothing
}

export async function logActivityBatch(..._args: any[]): Promise<void> {
  // Do nothing
}

export type ActivityLogEntry = Record<string, any>;
