"use client";

import { useState, useCallback, useEffect, useRef, type FormEvent } from "react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/utils";
import { setGuestName } from "./server-functions/guest";
import {
  createBidder,
  createBidderAndSetupIntent,
  savePaymentMethod,
  CURRENT_PLATFORM_TERMS_VERSION,
} from "@/stripe/server-functions/setup";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

interface RegistrationResult {
  userId?: string;
  name: string;
  hasCard: boolean;
}

interface RegistrationPanelProps {
  requirement: "guest" | "registered" | "card_on_file";
  onComplete: (reg: RegistrationResult) => void;
  onCancel: () => void;
  guestId: string;
}

export function RegistrationPanel({
  requirement,
  onComplete,
  onCancel,
  guestId,
}: RegistrationPanelProps) {
  const [open, setOpen] = useState(false);

  // Trigger slide-up on mount
  useEffect(() => {
    requestAnimationFrame(() => setOpen(true));
  }, []);

  function handleClose() {
    setOpen(false);
    // Wait for slide-down animation before calling onCancel
    setTimeout(onCancel, 200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/60 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          "relative z-10 w-full max-w-[420px] rounded-t-2xl bg-zinc-900 p-6 transition-transform duration-200 ease-out",
          open ? "translate-y-0" : "translate-y-full"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Registration"
      >
        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 flex h-12 min-w-12 items-center justify-center rounded-md text-lg text-zinc-400 hover:text-white"
          aria-label="Close"
        >
          Close
        </button>

        {requirement === "guest" && (
          <GuestTier onComplete={onComplete} />
        )}
        {requirement === "registered" && (
          <RegisteredTier guestId={guestId} onComplete={onComplete} />
        )}
        {requirement === "card_on_file" && (
          <CardOnFileTier guestId={guestId} onComplete={onComplete} />
        )}
      </div>
    </div>
  );
}

function RegisteredTier({
  guestId,
  onComplete,
}: {
  guestId: string;
  onComplete: (reg: RegistrationResult) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      let hasError = false;

      if (!trimmedName) {
        setNameError("Name is required");
        hasError = true;
      } else {
        setNameError(null);
      }

      const atIndex = trimmedEmail.indexOf("@");
      if (!trimmedEmail || atIndex < 1 || trimmedEmail.indexOf(".", atIndex) === -1) {
        setEmailError("Valid email is required");
        hasError = true;
      } else {
        setEmailError(null);
      }

      if (!termsAccepted) {
        setTermsError("You must accept the Terms of Service");
        hasError = true;
      } else {
        setTermsError(null);
      }

      if (hasError) return;

      setServerError(null);
      setSubmitting(true);

      try {
        const result = await createBidder({
          name: trimmedName,
          email: trimmedEmail,
          guestId,
          acceptedTermsVersion: CURRENT_PLATFORM_TERMS_VERSION,
        });
        onComplete({ userId: result.userId, name: result.userName, hasCard: false });
      } catch {
        setServerError("Something went wrong. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [name, email, guestId, termsAccepted, onComplete]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-white">
        Register to participate
      </h2>

      <div className="space-y-2">
        <Input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          className="h-12 bg-zinc-800 text-lg text-white placeholder:text-zinc-500 border-zinc-700"
          autoFocus
          aria-invalid={!!nameError}
          aria-describedby={nameError ? "reg-name-error" : undefined}
        />
        {nameError && (
          <p id="reg-name-error" className="text-sm font-medium text-red-400">
            {nameError}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(null);
          }}
          className="h-12 bg-zinc-800 text-lg text-white placeholder:text-zinc-500 border-zinc-700"
          aria-invalid={!!emailError}
          aria-describedby={emailError ? "reg-email-error" : undefined}
        />
        {emailError && (
          <p id="reg-email-error" className="text-sm font-medium text-red-400">
            {emailError}
          </p>
        )}
      </div>

      <TermsCheckbox
        checked={termsAccepted}
        onChange={(checked) => {
          setTermsAccepted(checked);
          if (termsError) setTermsError(null);
        }}
        error={termsError}
        id="reg-terms"
      />

      {serverError && (
        <p className="text-sm font-medium text-red-400">{serverError}</p>
      )}

      <Button
        type="submit"
        disabled={submitting}
        className="h-12 w-full text-lg font-semibold"
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Registering…
          </span>
        ) : (
          "Register"
        )}
      </Button>
    </form>
  );
}

// Cache stripePromise per publishable key
let stripePromiseCache: { key: string; promise: Promise<Stripe | null> } | null = null;
function getStripePromise(publishableKey: string) {
  if (!stripePromiseCache || stripePromiseCache.key !== publishableKey) {
    stripePromiseCache = { key: publishableKey, promise: loadStripe(publishableKey) };
  }
  return stripePromiseCache.promise;
}

function CardOnFileTier({
  guestId,
  onComplete,
}: {
  guestId: string;
  onComplete: (reg: RegistrationResult) => void;
}) {
  const [step, setStep] = useState<"info" | "card">("info");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stripeData, setStripeData] = useState<{
    userId: string;
    clientSecret: string;
    publishableKey: string;
  } | null>(null);

  const handleInfoSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      let hasError = false;

      if (!trimmedName) {
        setNameError("Name is required");
        hasError = true;
      } else {
        setNameError(null);
      }

      const atIndex = trimmedEmail.indexOf("@");
      if (!trimmedEmail || atIndex < 1 || trimmedEmail.indexOf(".", atIndex) === -1) {
        setEmailError("Valid email is required");
        hasError = true;
      } else {
        setEmailError(null);
      }

      if (!termsAccepted) {
        setTermsError("You must accept the Terms of Service");
        hasError = true;
      } else {
        setTermsError(null);
      }

      if (hasError) return;

      setServerError(null);
      setSubmitting(true);

      try {
        const result = await createBidderAndSetupIntent({
          name: trimmedName,
          email: trimmedEmail,
          guestId,
          acceptedTermsVersion: CURRENT_PLATFORM_TERMS_VERSION,
        });
        setStripeData(result);
        setStep("card");
      } catch {
        setServerError("Something went wrong. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [name, email, guestId, termsAccepted]
  );

  if (step === "card" && stripeData) {
    return (
      <Elements
        stripe={getStripePromise(stripeData.publishableKey)}
        options={{ clientSecret: stripeData.clientSecret }}
      >
        <CardStep
          userId={stripeData.userId}
          name={name.trim()}
          onComplete={onComplete}
          onBack={() => setStep("info")}
        />
      </Elements>
    );
  }

  return (
    <form onSubmit={handleInfoSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-white">
        Register to participate
      </h2>

      <div className="space-y-2">
        <Input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          className="h-12 bg-zinc-800 text-lg text-white placeholder:text-zinc-500 border-zinc-700"
          autoFocus
          aria-invalid={!!nameError}
          aria-describedby={nameError ? "cof-name-error" : undefined}
        />
        {nameError && (
          <p id="cof-name-error" className="text-sm font-medium text-red-400">
            {nameError}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Input
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (emailError) setEmailError(null);
          }}
          className="h-12 bg-zinc-800 text-lg text-white placeholder:text-zinc-500 border-zinc-700"
          aria-invalid={!!emailError}
          aria-describedby={emailError ? "cof-email-error" : undefined}
        />
        {emailError && (
          <p id="cof-email-error" className="text-sm font-medium text-red-400">
            {emailError}
          </p>
        )}
      </div>

      <TermsCheckbox
        checked={termsAccepted}
        onChange={(checked) => {
          setTermsAccepted(checked);
          if (termsError) setTermsError(null);
        }}
        error={termsError}
        id="cof-terms"
      />

      {serverError && (
        <p className="text-sm font-medium text-red-400">{serverError}</p>
      )}

      <Button
        type="submit"
        disabled={submitting}
        className="h-12 w-full text-lg font-semibold"
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Setting up…
          </span>
        ) : (
          "Continue"
        )}
      </Button>
    </form>
  );
}

function CardStep({
  userId,
  name,
  onComplete,
  onBack,
}: {
  userId: string;
  name: string;
  onComplete: (reg: RegistrationResult) => void;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!stripe || !elements) return;

      setError(null);
      setSubmitting(true);

      try {
        const result = await stripe.confirmSetup({
          elements,
          confirmParams: {
            return_url: window.location.href,
          },
          redirect: "if_required",
        });

        if (result.error) {
          setError(result.error.message ?? "Card could not be saved. Please try again.");
          return;
        }

        const paymentMethodId =
          typeof result.setupIntent.payment_method === "string"
            ? result.setupIntent.payment_method
            : result.setupIntent.payment_method?.id;

        if (!paymentMethodId) {
          setError("Could not retrieve payment method. Please try again.");
          return;
        }

        await savePaymentMethod({ userId, stripePaymentMethodId: paymentMethodId });
        onComplete({ userId, name, hasCard: true });
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [stripe, elements, userId, name, onComplete]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Add payment method</h2>

      <div className="min-h-[200px]">
        <PaymentElement
          onReady={() => setReady(true)}
          options={{
            layout: "tabs",
          }}
        />
        {!ready && (
          <div className="flex items-center justify-center py-8">
            <span className="size-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm font-medium text-red-400">{error}</p>
      )}

      <Button
        type="submit"
        disabled={submitting || !ready}
        className="h-12 w-full text-lg font-semibold"
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Saving…
          </span>
        ) : (
          "Save Card"
        )}
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="w-full text-center text-sm text-zinc-400 hover:text-white"
      >
        Back
      </button>
    </form>
  );
}

function TermsCheckbox({
  checked,
  onChange,
  error,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error: string | null;
  id: string;
}) {
  return (
    <div className="space-y-2">
      <label className="flex min-h-12 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="size-5 shrink-0 accent-white"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <span className="text-base text-zinc-300">
          I agree to the{" "}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white underline hover:text-zinc-200"
          >
            Terms of Service
          </a>
        </span>
      </label>
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function GuestTier({
  onComplete,
}: {
  onComplete: (reg: RegistrationResult) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      const trimmed = name.trim();
      if (!trimmed) {
        setError("Name is required");
        return;
      }

      setError(null);
      setSubmitting(true);

      try {
        const ok = await setGuestName(trimmed);
        if (!ok) {
          setError("Something went wrong. Please try again.");
          return;
        }
        onComplete({ name: trimmed, hasCard: false });
      } catch {
        setError("Something went wrong. Please try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [name, onComplete]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold text-white">
        Enter your name to join
      </h2>

      <div className="space-y-2">
        <Input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          className="h-12 bg-zinc-800 text-lg text-white placeholder:text-zinc-500 border-zinc-700"
          autoFocus
          aria-invalid={!!error}
          aria-describedby={error ? "name-error" : undefined}
        />
        {error && (
          <p id="name-error" className="text-sm font-medium text-red-400">
            {error}
          </p>
        )}
      </div>

      <Button
        type="submit"
        disabled={submitting}
        className="h-12 w-full text-lg font-semibold"
      >
        {submitting ? (
          <span className="flex items-center gap-2">
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Joining…
          </span>
        ) : (
          "Join"
        )}
      </Button>
    </form>
  );
}
