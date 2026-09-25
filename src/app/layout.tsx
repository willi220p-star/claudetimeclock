import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { BASE_PATH, PAGE_BACKGROUND } from "@/lib/brand";
import { contentSecurityPolicy } from "@/lib/csp";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DGK Clock",
    template: "%s · DGK Clock",
  },
  description: "Clock in and track your placement hours at DGK Business Consultancy, Palmerston.",
  applicationName: "DGK Clock",
  icons: {
    icon: [
      { url: `${BASE_PATH}/favicon.ico`, sizes: "32x32" },
      { url: `${BASE_PATH}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: `${BASE_PATH}/icons/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { title: "DGK Clock", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: PAGE_BACKGROUND,
};

const csp = contentSecurityPolicy(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NODE_ENV === "development",
);

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className={`${inter.variable} h-full antialiased`}>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={csp} />
      </head>
      <body className="min-h-full">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
