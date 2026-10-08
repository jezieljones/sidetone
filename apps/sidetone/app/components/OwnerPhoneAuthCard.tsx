"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SignOutButton,
  useAuth,
  useSignIn,
  useSignUp,
  useUser
} from "@clerk/nextjs";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { formatUsPhoneInput } from "../lib/phone-format";

type AuthMode = "sign-in" | "sign-up";

function toE164(phoneNumber: string) {
  const digits = phoneNumber.replace(/\D/g, "");
  return `+1${digits}`;
}

function getClerkErrorMessage(error: unknown, fallback: string) {
  if (!error) {
    return fallback;
  }

  if (error instanceof Error) {
    return error.message;
  }

  const clerkError = error as {
    errors?: Array<{ longMessage?: string; message?: string; code?: string }>;
    message?: string;
  };

  return (
    clerkError.errors?.[0]?.longMessage ??
    clerkError.errors?.[0]?.message ??
    clerkError.message ??
    fallback
  );
}

function sanitizeRedirectPath(path?: string) {
  if (!path?.startsWith("/") || path.startsWith("//")) {
    return "/dashboard";
  }

  return path;
}

function PhoneOtpAuthInner({ afterAuthPath = "/dashboard" }: { afterAuthPath?: string }) {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const {
    errors: signInErrors,
    fetchStatus: signInFetchStatus,
    signIn
  } = useSignIn();
  const {
    errors: signUpErrors,
    fetchStatus: signUpFetchStatus,
    signUp
  } = useSignUp();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [step, setStep] = useState<"collect" | "verify">("collect");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clerkBusy = signInFetchStatus === "fetching" || signUpFetchStatus === "fetching";
  const isSubmitting = busy || clerkBusy;

  const submitLabel = useMemo(() => {
    if (isSubmitting) return step === "collect" ? "Sending..." : "Verifying...";
    if (step === "collect") return "Send code";
    return "Verify code";
  }, [isSubmitting, step]);

  const resolvedAfterAuthPath = sanitizeRedirectPath(afterAuthPath);

  async function navigateAfterAuth() {
    router.refresh();
    router.push(resolvedAfterAuthPath);
  }

  function resetAttempt() {
    setStep("collect");
    setVerificationCode("");
    setLegalAccepted(false);
    setError(null);
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    resetAttempt();
  }

  async function sendCode() {
    if (phoneNumber.replace(/\D/g, "").length !== 10) {
      setError("Enter a valid 10-digit phone number.");
      return;
    }

    if (mode === "sign-up" && !legalAccepted) {
      setError("Confirm that you consent to receive text messages from Sidetone.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const e164 = toE164(phoneNumber);

      if (mode === "sign-in") {
        if (!signIn) {
          throw new Error("Phone sign-in is not ready yet.");
        }

        const createResult = await signIn.create({ identifier: e164 });
        if (createResult.error) {
          throw createResult.error;
        }

        const sendResult = await signIn.phoneCode.sendCode({ phoneNumber: e164 });
        if (sendResult.error) {
          throw sendResult.error;
        }
      } else {
        if (!signUp) {
          throw new Error("Phone sign-up is not ready yet.");
        }

        const createResult = await signUp.create({ phoneNumber: e164, legalAccepted });
        if (createResult.error) {
          throw createResult.error;
        }

        const sendResult = await signUp.verifications.sendPhoneCode({});
        if (sendResult.error) {
          throw sendResult.error;
        }
      }

      setStep("verify");
    } catch (err) {
      setError(getClerkErrorMessage(err, "Unable to send verification code."));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (verificationCode.length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (mode === "sign-in") {
        if (!signIn) {
          throw new Error("Phone sign-in is not ready yet.");
        }

        const result = await signIn.phoneCode.verifyCode({
          code: verificationCode
        });

        if (result.error) {
          throw result.error;
        }

        if (signIn.status === "complete") {
          await signIn.finalize({
            navigate: async ({ session, decorateUrl }) => {
              if (session?.currentTask) {
                return;
              }

              const url = decorateUrl(resolvedAfterAuthPath);
              if (url.startsWith("http")) {
                window.location.href = url;
              } else {
                router.push(url);
              }
            }
          });
          await navigateAfterAuth();
          return;
        }

        throw new Error("Phone verification did not complete.");
      } else {
        if (!signUp) {
          throw new Error("Phone sign-up is not ready yet.");
        }

        const result = await signUp.verifications.verifyPhoneCode({
          code: verificationCode
        });

        if (result.error) {
          throw result.error;
        }

        if (signUp.status === "complete") {
          await signUp.finalize({
            navigate: async ({ session, decorateUrl }) => {
              if (session?.currentTask) {
                return;
              }

              const url = decorateUrl(resolvedAfterAuthPath);
              if (url.startsWith("http")) {
                window.location.href = url;
              } else {
                router.push(url);
              }
            }
          });
          await navigateAfterAuth();
          return;
        }

        throw new Error(`Phone verification needs more account setup: ${signUp.missingFields.join(", ") || signUp.status}.`);
      }
    } catch (err) {
      setError(getClerkErrorMessage(err, "Unable to verify code."));
    } finally {
      setBusy(false);
    }
  }

  if (isSignedIn) {
    return (
      <Card>
        <CardHeader className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">
                {user?.fullName ?? user?.primaryPhoneNumber?.phoneNumber ?? "Signed in"}
              </CardTitle>
            </div>
            <Badge variant="success">Authenticated</Badge>
          </div>
          <CardDescription className="text-base leading-7">
            Your phone session is active for Sidetone calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 px-6 pb-6">
          <Badge variant="neutral">
            {user?.primaryPhoneNumber?.phoneNumber ?? "Phone session active"}
          </Badge>
          <SignOutButton redirectUrl="/">
            <Button type="button" variant="secondary">Sign out</Button>
          </SignOutButton>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="auth-card h-full w-full max-w-full">
      <CardHeader className="p-5 pb-4 md:p-6 md:pb-4">
        <div className="grid min-w-0 gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
          <div className="min-w-0">
            <CardTitle className="text-4xl leading-none md:text-5xl">
              {mode === "sign-in" ? "Welcome back." : "Start your first call."}
            </CardTitle>
          </div>
          <div className="grid w-full min-w-0 grid-cols-2 rounded-md border border-cream-200/45 bg-navy-900/35 p-1 sm:w-auto">
            <button
              aria-pressed={mode === "sign-in"}
              className={mode === "sign-in" ? "inline-flex h-10 min-w-0 items-center justify-center rounded-md border border-primary bg-primary px-3 font-mono text-xs font-black uppercase tracking-[0.12em] text-primary-foreground" : "inline-flex h-10 min-w-0 items-center justify-center rounded-md border border-transparent px-3 font-mono text-xs font-black uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"}
              onClick={() => switchMode("sign-in")}
              type="button"
            >
              Sign in
            </button>
            <button
              aria-pressed={mode === "sign-up"}
              className={mode === "sign-up" ? "inline-flex h-10 min-w-0 items-center justify-center rounded-md border border-primary bg-primary px-3 font-mono text-xs font-black uppercase tracking-[0.12em] text-primary-foreground" : "inline-flex h-10 min-w-0 items-center justify-center rounded-md border border-transparent px-3 font-mono text-xs font-black uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"}
              onClick={() => switchMode("sign-up")}
              type="button"
            >
              Sign up
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4 px-5 pb-5 md:px-6 md:pb-6">
        {step === "collect" ? (
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Phone number</span>
              <Input
                autoComplete="tel-national"
                inputMode="tel"
                value={phoneNumber}
                onChange={(event) => {
                  setPhoneNumber(formatUsPhoneInput(event.target.value));
                  setError(null);
                }}
                placeholder="(xxx) xxx-xxxx"
              />
            </label>
            {mode === "sign-up" ? (
              <>
                <label className="flex items-start gap-3 rounded-md border border-cream-200/35 bg-navy-900/25 p-3 text-sm leading-6 text-muted-foreground">
                  <input
                    checked={legalAccepted}
                    className="mt-1 size-4"
                    onChange={(event) => {
                      setLegalAccepted(event.target.checked);
                      setError(null);
                    }}
                    type="checkbox"
                  />
                  <span>I consent to receive text messages from Sidetone.</span>
                </label>
              </>
            ) : null}
            <div id="clerk-captcha" />
            <Button className="h-[3.25rem] text-base" disabled={isSubmitting} onClick={sendCode} type="button">
              {submitLabel}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Verification code</span>
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                value={verificationCode}
                onChange={(event) => {
                  setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setError(null);
                }}
                placeholder="123456"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <Button className="flex-1" disabled={isSubmitting} onClick={verifyCode} type="button">{submitLabel}</Button>
              <Button
                className="flex-1"
                onClick={resetAttempt}
                type="button"
                variant="secondary"
              >
                Edit number
              </Button>
            </div>
          </div>
        )}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        {!error && mode === "sign-in" && signInErrors.fields.identifier?.message ? (
          <p className="text-sm text-destructive">{signInErrors.fields.identifier.message}</p>
        ) : null}
        {!error && mode === "sign-in" && signInErrors.fields.code?.message ? (
          <p className="text-sm text-destructive">{signInErrors.fields.code.message}</p>
        ) : null}
        {!error && mode === "sign-up" && signUpErrors.fields.phoneNumber?.message ? (
          <p className="text-sm text-destructive">{signUpErrors.fields.phoneNumber.message}</p>
        ) : null}
        {!error && mode === "sign-up" && signUpErrors.fields.code?.message ? (
          <p className="text-sm text-destructive">{signUpErrors.fields.code.message}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function OwnerPhoneAuthCard({
  afterAuthPath
}: {
  afterAuthPath?: string;
}) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return (
      <Card>
        <CardHeader className="p-6">
          <CardTitle className="text-2xl">Phone sign-in is not configured yet</CardTitle>
          <CardDescription className="text-base leading-7">
            Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
            `CLERK_JWT_ISSUER_DOMAIN` for Sidetone. This app uses phone sign-in
            before number setup and real calls.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <PhoneOtpAuthInner afterAuthPath={afterAuthPath} />;
}
