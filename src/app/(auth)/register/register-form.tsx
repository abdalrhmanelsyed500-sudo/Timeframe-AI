"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Button, Callout, Field, Input } from "@/components/ui/primitives";

const MIN_PASSWORD = 10;

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Please use at least ${MIN_PASSWORD} characters for your password.`);
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/v1/auth/register", { name, email, password });
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Callout tone="danger">{error}</Callout> : null}

      <Field label="Name" htmlFor="name" required>
        <Input id="name" name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
      </Field>

      <Field label="Email" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        required
        hint={`At least ${MIN_PASSWORD} characters.`}
        error={passwordTooShort ? `At least ${MIN_PASSWORD} characters.` : null}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </Field>

      <Button type="submit" variant="primary" loading={busy} className="w-full">
        Create account
      </Button>
    </form>
  );
}
