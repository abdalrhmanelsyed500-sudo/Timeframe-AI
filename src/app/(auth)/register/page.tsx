import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/security/auth";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getCurrentUser().catch(() => null)) redirect("/dashboard");

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink-50">Create your account</h1>
      <p className="mt-1.5 text-sm text-ink-400">Projects, credentials and renders are private to you.</p>
      <div className="mt-6">
        <RegisterForm />
      </div>
      <p className="mt-6 text-sm text-ink-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-amber-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
