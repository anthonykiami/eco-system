import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import "./globals.css";

const sans = Manrope({
  variable: "--font-sans-face",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ECO-SYSTEM",
  description: "Your AI agents, working together",
  applicationName: "ECO-SYSTEM",
  // Installed on an iPhone home screen: full screen, content under a translucent status bar.
  appleWebApp: { capable: true, title: "ECO-SYSTEM", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/favicon-32.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#040907",
  // Lets the installed app use the whole screen; padding keeps content clear of the notch.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
