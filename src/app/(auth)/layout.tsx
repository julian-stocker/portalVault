import Link from "next/link";

import { de } from "@/lib/i18n/de";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="px-6 py-4">
        <Link href="/" className="text-sm font-medium">
          {de.app.name}
        </Link>
      </header>
      {children}
    </div>
  );
}
