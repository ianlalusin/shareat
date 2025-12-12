
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/admin/logo';
import { useAuthContext } from '@/context/auth-context';
import { Eye, EyeOff } from 'lucide-react';

declare global {
  interface Window {
    grecaptcha: any;
    handleRecaptchaChange: (token: string | null) => void;
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [recaptchaToken, setRecaptchaToken] = useState<string | null>(null);
  const router = useRouter();
  const auth = useAuth();
  const { toast } = useToast();
  const { setDevMode } = useAuthContext();

  useEffect(() => {
    window.handleRecaptchaChange = (token: string | null) => {
      setRecaptchaToken(token);
    };

    return () => {
      delete window.handleRecaptchaChange;
    };
  }, []);

  const resetRecaptcha = () => {
    if (window.grecaptcha) {
      const widgetId = document.querySelector('.g-recaptcha')?.getAttribute('data-widget-id');
      if (widgetId) {
        window.grecaptcha.reset(parseInt(widgetId, 10));
      } else {
        // Fallback for multiple recaptchas if needed
         const recaptchas = document.querySelectorAll('.g-recaptcha');
         recaptchas.forEach((rc) => {
             const id = rc.getAttribute('data-widget-id');
             if(id) window.grecaptcha.reset(parseInt(id, 10));
         });
      }
    }
    setRecaptchaToken(null);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) return;
    if (!recaptchaToken) {
      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: 'Please complete the reCAPTCHA challenge.',
      });
      return;
    };
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push('/admin');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Login Failed',
        description: error.message,
      });
      setLoading(false);
      resetRecaptcha();
    }
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) return;
    if (!recaptchaToken) {
        toast({
          variant: 'destructive',
          title: 'Sign Up Failed',
          description: 'Please complete the reCAPTCHA challenge.',
        });
        return;
      }
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      if (userCredential.user) {
        await updateProfile(userCredential.user, {
          displayName: fullName,
        });
      }
      router.push('/admin');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Sign Up Failed',
        description: error.message,
      });
      setLoading(false);
      resetRecaptcha();
    }
  };
  
  const handleDevMode = () => {
    setDevMode(true);
    router.push('/admin');
  }

  return (
    <Tabs defaultValue="login" className="w-full max-w-md">
      <div className="flex justify-center mb-4">
        <div className="bg-primary text-primary-foreground p-3 rounded-full">
            <Logo className="h-8 w-8" />
        </div>
      </div>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="login">Login</TabsTrigger>
        <TabsTrigger value="signup">Sign Up</TabsTrigger>
      </TabsList>
      <TabsContent value="login">
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>
              Enter your credentials to access your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>
               <div className="flex justify-center">
                 <div
                    className="g-recaptcha"
                    data-sitekey="6LcUdyksAAAAAE28riY6RM7zxVfULa9sqQRqJi_1"
                    data-callback="handleRecaptchaChange"
                  ></div>
               </div>
              <Button type="submit" className="w-full" disabled={loading || !recaptchaToken}>
                {loading ? 'Logging in...' : 'Login'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="signup">
        <Card>
          <CardHeader>
            <CardTitle>Sign Up</CardTitle>
            <CardDescription>
              Create a new account to get started.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-fullname">Full Name</Label>
                <Input
                  id="signup-fullname"
                  type="text"
                  placeholder="Juan Dela Cruz"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  placeholder="m@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Password</Label>
                <div className="relative">
                  <Input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                   <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>
              <div className="flex justify-center">
                 <div
                    className="g-recaptcha"
                    data-sitekey="6LcUdyksAAAAAE28riY6RM7zxVfULa9sqQRqJi_1"
                    data-callback="handleRecaptchaChange"
                  ></div>
               </div>
              <Button type="submit" className="w-full" disabled={loading || !recaptchaToken}>
                {loading ? 'Creating Account...' : 'Sign Up'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
