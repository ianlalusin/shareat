
'use client';

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Logo } from './logo';

const CORRECT_PIN = '5254';
const LOCAL_STORAGE_KEY = 'shareat-hub-admin-auth';

export function PinLock({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    try {
      const storedAuth = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedAuth === 'true') {
        setIsAuthenticated(true);
      }
    } catch (e) {
      // localStorage is not available
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  useEffect(() => {
    if(!isLoading && !isAuthenticated) {
        inputRefs.current[0]?.focus();
    }
  }, [isLoading, isAuthenticated]);

  const handlePinChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newPin = pin.split('');
    newPin[index] = value.slice(-1);
    const newPinString = newPin.join('').slice(0, 4);
    setPin(newPinString);

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
  };
  
  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };
  
  const validatePin = (currentPin: string) => {
    if (currentPin === CORRECT_PIN) {
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, 'true');
        } catch (e) {
            // localStorage not available
        }
        setIsAuthenticated(true);
        setError('');
    } else {
        setError('Invalid PIN. Please try again.');
        setPin('');
        inputRefs.current[0]?.focus();
    }
  }

  useEffect(() => {
    if (pin.length === 4) {
      validatePin(pin);
    }
     if (pin.length > 0 && error) {
      setError('');
    }
  }, [pin]);

  if (isLoading) {
    return null; // or a loading spinner
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center bg-muted/40">
        <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
                <div className="mx-auto bg-primary text-primary-foreground p-3 rounded-full mb-4">
                    <Logo className="h-8 w-8" />
                </div>
                <CardTitle>Admin Access</CardTitle>
                <CardDescription>Enter your PIN to continue</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex justify-center gap-2 mb-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                    <Input
                        key={index}
                        ref={(el) => (inputRefs.current[index] = el)}
                        type="password"
                        maxLength={1}
                        value={pin[index] || ''}
                        onChange={(e) => handlePinChange(index, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(index, e)}
                        className="h-14 w-12 text-center text-2xl font-bold"
                        inputMode="numeric"
                    />
                    ))}
                </div>
                {error && <p className="text-sm text-center text-destructive mb-4">{error}</p>}
            </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
