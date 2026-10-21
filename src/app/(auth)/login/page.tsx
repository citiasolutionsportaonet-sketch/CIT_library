import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/tenant-context";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-xl font-semibold">CIT Library</h1>
        <p className="mb-6 text-sm text-slate-600">Entre com seu e-mail e senha.</p>
        <LoginForm />
        <p className="mt-6 text-xs text-slate-500">Não há cadastro público. Peça um convite a um administrador.</p>
      </div>
    </main>
  );
}
