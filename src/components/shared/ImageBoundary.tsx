'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ImageBoundaryState {
  hasError: boolean;
}

export class ImageBoundary extends React.Component<React.PropsWithChildren<{}>, ImageBoundaryState> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ImageBoundaryState {
    // Catch Next.js image config errors.
    if (error.message.includes('Invalid src prop') && error.message.includes('hostname')) {
        return { hasError: true };
    }
    // For other errors, re-throw them so they can be caught by a higher-level boundary if needed.
    throw error;
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (error.message.includes('Invalid src prop') && error.message.includes('hostname')) {
        console.warn("ImageBoundary caught an image configuration error:", error.message);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full bg-destructive/10 flex flex-col items-center justify-center text-center p-1 rounded-md" title="Image failed to load. Check next.config.js or re-upload the image.">
          <AlertTriangle className="h-1/3 w-1/3 text-destructive" />
          <p className="text-[9px] text-destructive/80 mt-1 leading-tight">Image failed. Please re-upload.</p>
        </div>
      );
    }

    return this.props.children;
  }
}
