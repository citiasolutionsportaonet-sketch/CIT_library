"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function LogoutButton({ className = "btn-secondary" }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        // Revoga a sessão no servidor (remove do banco) e apaga o cookie.
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      {pending ? "Saindo…" : "Sair"}
    </button>
  );
}
