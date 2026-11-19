import type { Metadata } from "next";
import { Manrope, Montserrat } from "next/font/google";
import { Suspense } from "react";
import { NavProgress } from "@/components/nav-progress";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-montserrat", display: "swap" });

export const metadata: Metadata = {
  title: "AmzCentric OS",
  description: "Internal Amazon advertising analytics for AmzCentric",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${manrope.variable} ${montserrat.variable}`}>
      <body className="font-sans antialiased">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
