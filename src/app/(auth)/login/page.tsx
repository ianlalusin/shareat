
'use client';

import { useState, useEffect, useRef } from 'react';
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
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const [loginRecaptchaToken, setLoginRecaptchaToken] = useState<string | null>(null);
  const [signupRecaptchaToken, setSignupRecaptchaToken] = useState<string | null>(null);

  const loginRecaptchaRef = useRef<HTMLDivElement>(null);
  const signupRecaptchaRef = useRef<HTMLDivElement>(null);
  const loginWidgetId = useRef<number | null>(null);
  const signupWidgetId = useRef<number | null>(null);

  const router = useRouter();
  const auth = useAuth();
  const { toast } = useToast();
  const { setDevMode } = useAuthContext();
  
  const renderRecaptcha = () => {
    if (window.grecaptcha && window.grecaptcha.render) {
        if (loginRecaptchaRef.current && loginWidgetId.current === null) {
            loginWidgetId.current = window.grecaptcha.render(loginRecaptchaRef.current, {
                'sitekey': '6LcUdyksAAAAAE28riY6RM7zxVfULa9sqQRqJi_1',
                'callback': (token: string) => setLoginRecaptchaToken(token),
            });
        }
        if (signupRecaptchaRef.current && signupWidgetId.current === null) {
            signupWidgetId.current = window.grecaptcha.render(signupRecaptchaRef.current, {
                'sitekey': '6LcUdyksAAAAAE28riY6RM7zxVfULa9sqQRqJi_1',
                'callback': (token: string) => setSignupRecaptchaToken(token)
            });
        }
    }
  };

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?onload=onloadCallback&render=explicit';
    script.async = true;
    script.defer = true;
    (window as any).onloadCallback = renderRecaptcha;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
      delete (window as any).onloadCallback;
    }
  }, []);

  const handleTabChange = (value: string) => {
    // Reset tokens when switching tabs
    setLoginRecaptchaToken(null);
    setSignupRecaptchaToken(null);
    if(window.grecaptcha) {
        if (value === 'login' && loginWidgetId.current !== null) {
            window.grecaptcha.reset(loginWidgetId.current);
        } else if (value === 'signup' && signupWidgetId.current !== null) {
            window.grecaptcha.reset(signupWidgetId.current);
        }
    }
  };


  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) return;
    if (!loginRecaptchaToken) {
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
      if(window.grecaptcha && loginWidgetId.current !== null) {
        window.grecaptcha.reset(loginWidgetId.current);
      }
      setLoginRecaptchaToken(null);
    }
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) return;
    if (!signupRecaptchaToken) {
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
      if(window.grecaptcha && signupWidgetId.current !== null) {
        window.grecaptcha.reset(signupWidgetId.current);
      }
      setSignupRecaptchaToken(null);
    }
  };
  
  const handleDevMode = () => {
    setDevMode(true);
    router.push('/admin');
  }

  return (
    <Tabs defaultValue="login" className="w-full max-w-md" onValueChange={handleTabChange}>
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
                 <div ref={loginRecaptchaRef}></div>
               </div>
              <Button type="submit" className="w-full" disabled={loading || !loginRecaptchaToken}>
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
                 <div ref={signupRecaptchaRef}></div>
               </div>
              <Button type="submit" className="w-full" disabled={loading || !signupRecaptchaToken}>
                {loading ? 'Creating Account...' : 'Sign Up'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
