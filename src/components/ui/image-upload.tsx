
'use client';

import * as React from 'react';
import Image from 'next/image';
import { Image as ImageIcon, Upload, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ImageUploadProps {
  imageUrl?: string | null;
  onFileChange: (file: File | null) => void;
  icon?: React.ReactNode;
  className?: string;
}

export function ImageUpload({
  imageUrl,
  onFileChange,
  icon,
  className,
}: ImageUploadProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileChange(e.target.files[0]);
    }
  };

  const defaultIcon = <ImageIcon className="h-10 w-10 text-muted-foreground" />;

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="h-24 w-24 flex-shrink-0 items-center justify-center rounded-md bg-muted overflow-hidden relative border">
        {imageUrl ? (
          <Image src={imageUrl} alt="Image Preview" layout="fill" objectFit="cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {icon || defaultIcon}
          </div>
        )}
      </div>
      <div className="flex-grow space-y-2">
        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
        />
        <Button type="button" variant="outline" onClick={handleButtonClick}>
          <Upload className="mr-2 h-4 w-4" />
          Upload Image
        </Button>
        <p className="text-xs text-muted-foreground">
          PNG, JPG, GIF up to 5MB.
        </p>
      </div>
    </div>
  );
}
