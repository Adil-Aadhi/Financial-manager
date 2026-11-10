import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { themeInitScript } from "@/components/theme/theme-script";
import { accentInitScript } from "@/components/theme/accent";
import { timeZoneCookieScript } from "@/lib/month";
import { OfflineDataProvider } from "@/components/offline/OfflineDataProvider";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { AppLaunchScreen } from "@/components/pwa/AppLaunchScreen";
import { PendingChangesNotice } from "@/components/offline/PendingChangesNotice";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Money font: every amount uses the `font-money` utility. */
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AccountTracker",
  description: "Track spending, budgets and savings goals with clarity.",
  manifest: "/manifest.webmanifest",
  applicationName: "AccountTracker",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AccountTracker",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  // Lets content extend under the iPhone notch / home indicator; layouts pad with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5fa" },
    { media: "(prefers-color-scheme: dark)", color: "#060911" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript + ";" + accentInitScript + ";" + timeZoneCookieScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AppLaunchScreen />
        <ThemeProvider>
          <OfflineDataProvider>{children}</OfflineDataProvider>
          <ServiceWorkerRegistration />
          <PendingChangesNotice />
        </ThemeProvider>
      </body>
    </html>
  );
}
