import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";

export default function SignInPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) redirect("/setup");
  return <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-8 p-6"><a href="/" className="text-3xl font-semibold">Sidetone</a><SignIn routing="hash" fallbackRedirectUrl="/dashboard" signUpFallbackRedirectUrl="/dashboard" /></main>;
}
