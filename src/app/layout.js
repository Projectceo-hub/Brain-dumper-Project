import { Inter } from "next/font/google";
import { Instrument_Serif } from "next/font/google";
import AuthGate from "@/components/AuthGate";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import ThemeProvider from "@/components/ThemeProvider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Phase 7B display face. Instrument Serif ships a single weight (400);
// the mockups use it at 16-20px for note/page titles only.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

// PWA manifest + Apple web-app metadata. Next.js renders these into the
// <head> as <link rel="manifest">, <meta name="theme-color">, etc.
export const metadata = {
  title: "MindCanvas",
  description: "Your second brain — capture, organize, visualize.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "MindCanvas",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

// themeColor moved to the `viewport` export in Next 14+.
export const viewport = {
  themeColor: "#1C1912",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" style={{ background: "var(--bg)" }}>
        <ThemeProvider>
          <AuthGate>{children}</AuthGate>
        </ThemeProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
