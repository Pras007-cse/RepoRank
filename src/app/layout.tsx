import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import Navbar from "@/components/Navbar";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: "RepoRank — GitHub Developer Discovery & Leaderboard",
  description:
    "Discover open-source repositories, support projects with verified GitHub stars, and climb the RepoRank contribution leaderboard.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${jbmono.variable} font-sans antialiased bg-base-950 min-h-screen`}>
        <Providers>
          <div className="fixed inset-0 -z-10 bg-grid-fade pointer-events-none" />
          <Navbar />
          <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
