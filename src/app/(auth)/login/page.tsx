import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/security/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser().catch(() => null)) redirect("/dashboard");

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink-50">Sign in</h1>
      <p className="mt-1.5 text-sm text-ink-400">Continue where you left off.</p>
      <div className="mt-6">
        <LoginForm />
      </div>
      <p className="mt-6 text-sm text-ink-400">
        No account?{" "}
        <Link href="/register" className="font-medium text-amber-accent hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
