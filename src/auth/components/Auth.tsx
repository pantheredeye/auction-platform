"use client";

import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useState, useTransition } from "react";
import {
  finishPasskeyLogin,
  finishPasskeyRegistration,
  startPasskeyLogin,
  startPasskeyRegistration,
} from "@/passkey/functions";
import {
  checkUsername,
  loginWithPassword,
  registerWithPassword,
} from "../functions";

import { Button } from "@/app/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Alert, AlertDescription } from "@/app/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import { getPasswordStrength, validatePasswordStrength } from "../password";
import { Eye, EyeOff } from "lucide-react";

type AuthMethod = "password" | "passkey";

type AuthState =
  | "USERNAME_ENTRY"
  | "PASSWORD_LOGIN"
  | "PASSKEY_LOGIN"
  | "METHOD_CHOICE"
  | "PASSWORD_REGISTER"
  | "PASSKEY_REGISTER";

type ResultState = {
  type: "success" | "error";
  message: string;
} | null;

export function Auth() {
  const [state, setState] = useState<AuthState>("USERNAME_ENTRY");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<AuthMethod>("passkey");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [result, setResult] = useState<ResultState>(null);
  const [isPending, startTransition] = useTransition();

  const handleContinue = async () => {
    if (!username.trim()) {
      setResult({ type: "error", message: "Username is required" });
      return;
    }

    try {
      const { exists, authMethod } = await checkUsername(username);

      if (exists && authMethod) {
        if (authMethod === "password") {
          setState("PASSWORD_LOGIN");
        } else if (authMethod === "passkey") {
          setState("PASSKEY_LOGIN");
        } else {
          setState("PASSKEY_LOGIN");
        }
      } else {
        setState("METHOD_CHOICE");
      }
      setResult(null);
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to check username",
      });
    }
  };

  const handleMethodChoice = () => {
    if (selectedMethod === "password") {
      setState("PASSWORD_REGISTER");
    } else {
      setState("PASSKEY_REGISTER");
    }
    setResult(null);
  };

  const handlePasswordLogin = async () => {
    try {
      const response = await loginWithPassword(username, password);

      if (response.success) {
        window.location.href = response.redirectTo || "/dashboard";
      } else {
        setResult({ type: "error", message: response.error || "Login failed" });
        setPassword("");
      }
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "Login failed",
      });
      setPassword("");
    }
  };

  const handlePasswordRegister = async () => {
    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
      setResult({ type: "error", message: validation.errors[0] });
      return;
    }

    if (password !== confirmPassword) {
      setResult({ type: "error", message: "Passwords do not match" });
      return;
    }

    try {
      const response = await registerWithPassword(username, password);

      if (response.success) {
        window.location.href = response.redirectTo || "/dashboard";
      } else {
        setResult({ type: "error", message: response.error || "Registration failed" });
      }
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "Registration failed",
      });
    }
  };

  const handlePasskeyLogin = async () => {
    try {
      const options = await startPasskeyLogin();
      const login = await startAuthentication({ optionsJSON: options });
      const result = await finishPasskeyLogin(login);

      if (result.success) {
        window.location.href = result.redirectTo || "/dashboard";
      } else {
        setResult({ type: "error", message: "Login failed" });
      }
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "Unexpected login error",
      });
    }
  };

  const handlePasskeyRegister = async () => {
    try {
      const options = await startPasskeyRegistration(username);
      const registration = await startRegistration({ optionsJSON: options });
      const result = await finishPasskeyRegistration(username, registration);

      if (result.success) {
        window.location.href = result.redirectTo || "/dashboard";
      } else {
        setResult({
          type: "error",
          message: "Registration failed. Username may already exist.",
        });
      }
    } catch (error) {
      setResult({
        type: "error",
        message: error instanceof Error ? error.message : "Unexpected registration error",
      });
    }
  };

  const handleBack = () => {
    setState("USERNAME_ENTRY");
    setPassword("");
    setConfirmPassword("");
    setResult(null);
  };

  const passwordStrength = password ? getPasswordStrength(password) : 0;
  const strengthColors = ["bg-gray-200", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-green-500"];
  const strengthLabels = ["", "Weak", "Fair", "Good", "Strong"];

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          {state === "USERNAME_ENTRY" && (
            <>
              <CardTitle>Sign in or create account</CardTitle>
              <CardDescription>Enter your username to continue</CardDescription>
            </>
          )}
          {state === "PASSWORD_LOGIN" && (
            <>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>{username}</CardDescription>
            </>
          )}
          {state === "PASSKEY_LOGIN" && (
            <>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>{username}</CardDescription>
            </>
          )}
          {state === "METHOD_CHOICE" && (
            <>
              <CardTitle>Create your account</CardTitle>
              <CardDescription>Choose how to sign in</CardDescription>
            </>
          )}
          {state === "PASSWORD_REGISTER" && (
            <>
              <CardTitle>Create your account</CardTitle>
              <CardDescription>{username}</CardDescription>
            </>
          )}
          {state === "PASSKEY_REGISTER" && (
            <>
              <CardTitle>Create your account</CardTitle>
              <CardDescription>{username}</CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {state === "USERNAME_ENTRY" && (
            <>
              <Button
                onClick={() => startTransition(handlePasskeyLogin)}
                disabled={isPending}
                className="w-full"
              >
                {isPending ? "Waiting for passkey..." : "Sign in with passkey"}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    Or continue with username
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username webauthn"
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && !isPending && startTransition(handleContinue)}
                  placeholder="you@example.com"
                  disabled={isPending}
                />
              </div>
            </>
          )}

          {state === "PASSWORD_LOGIN" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username-display">Username</Label>
                <Input id="username-display" value={username} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    autoComplete="current-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === "Enter" && !isPending && startTransition(handlePasswordLogin)}
                    placeholder="Enter password"
                    disabled={isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {state === "PASSKEY_LOGIN" && (
            <div className="space-y-2">
              <Label htmlFor="username-display">Username</Label>
              <Input id="username-display" value={username} disabled className="bg-muted" />
            </div>
          )}

          {state === "METHOD_CHOICE" && (
            <RadioGroup value={selectedMethod} onValueChange={(val) => setSelectedMethod(val as AuthMethod)}>
              <div className="space-y-3">
                <div className="flex items-start space-x-3 space-y-0">
                  <RadioGroupItem value="passkey" id="method-passkey" />
                  <div className="space-y-1 leading-none">
                    <Label htmlFor="method-passkey" className="font-medium cursor-pointer">
                      Passkey
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Modern, secure, no passwords to remember
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 space-y-0">
                  <RadioGroupItem value="password" id="method-password" />
                  <div className="space-y-1 leading-none">
                    <Label htmlFor="method-password" className="font-medium cursor-pointer">
                      Password
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Traditional and works everywhere
                    </p>
                  </div>
                </div>
              </div>
            </RadioGroup>
          )}

          {state === "PASSWORD_REGISTER" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username-display">Username</Label>
                <Input id="username-display" value={username} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">Password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    name="password"
                    autoComplete="new-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    placeholder="Create password"
                    disabled={isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {password && (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded ${
                            i <= passwordStrength ? strengthColors[passwordStrength] : "bg-gray-200"
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {strengthLabels[passwordStrength]} - 12+ chars, mixed case, numbers, symbols
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    name="password"
                    autoComplete="new-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === "Enter" && !isPending && startTransition(handlePasswordRegister)}
                    placeholder="Confirm password"
                    disabled={isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {state === "PASSKEY_REGISTER" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username-display">Username</Label>
                <Input id="username-display" value={username} disabled className="bg-muted" />
              </div>
              <div className="rounded-lg border p-4 space-y-2">
                <p className="text-sm">
                  You'll use your device's biometrics or security key to sign in. No password needed.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {state === "USERNAME_ENTRY" && username.trim() && (
              <Button
                onClick={() => startTransition(handleContinue)}
                disabled={isPending}
                variant="outline"
              >
                Continue with username
              </Button>
            )}

            {state === "PASSWORD_LOGIN" && (
              <>
                <Button
                  onClick={() => startTransition(handlePasswordLogin)}
                  disabled={isPending || !password}
                >
                  {isPending ? "Signing in..." : "Sign in"}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
              </>
            )}

            {state === "PASSKEY_LOGIN" && (
              <>
                <Button
                  onClick={() => startTransition(handlePasskeyLogin)}
                  disabled={isPending}
                >
                  {isPending ? "Waiting for passkey..." : "Sign in with passkey"}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
              </>
            )}

            {state === "METHOD_CHOICE" && (
              <>
                <Button
                  onClick={() => startTransition(handleMethodChoice)}
                  disabled={isPending}
                >
                  Continue
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
              </>
            )}

            {state === "PASSWORD_REGISTER" && (
              <>
                <Button
                  onClick={() => startTransition(handlePasswordRegister)}
                  disabled={isPending || !password || !confirmPassword}
                >
                  {isPending ? "Creating account..." : "Create account"}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
              </>
            )}

            {state === "PASSKEY_REGISTER" && (
              <>
                <Button
                  onClick={() => startTransition(handlePasskeyRegister)}
                  disabled={isPending}
                >
                  {isPending ? "Creating passkey..." : "Create passkey"}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back
                </Button>
              </>
            )}
          </div>
        </CardContent>

        {result && (
          <CardFooter>
            <Alert
              variant={result.type === "error" ? "destructive" : "default"}
              className="w-full"
            >
              <AlertDescription>{result.message}</AlertDescription>
            </Alert>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
