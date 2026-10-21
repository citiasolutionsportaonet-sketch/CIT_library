import { LogoutButton } from "@/components/logout-button";

export default function SemAcesso() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="card max-w-md p-6 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Sem organização ativa</h1>
        <p className="mb-4 text-slate-600">Sua conta não participa de nenhuma organização ativa. Peça um convite a um administrador.</p>
        <LogoutButton />
      </div>
    </main>
  );
}
