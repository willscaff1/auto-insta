import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Painel de Publicações | AlertaTCG",
  description:
    "Central editorial do AlertaTCG para acompanhar carrosséis, fontes, horários e publicações do Instagram.",
  icons: {
    icon: "/meowth-cover.png",
    shortcut: "/meowth-cover.png",
  },
  openGraph: {
    title: "AlertaTCG | Painel de Publicações",
    description: "Fila editorial, fontes verificadas e duas publicações por dia.",
    type: "website",
    locale: "pt_BR",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Painel editorial AlertaTCG" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
