import type { Metadata } from "next";
import "./globals.css";

// Tudo é privado e por requisição: nada é pré-renderizado no build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "CIT Library", template: "%s · CIT Library" },
  description: "Biblioteca interna de produtos",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
