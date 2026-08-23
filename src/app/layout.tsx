import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Are We Really Friends? — A Friendship Experiment",
    template: "%s | A.W.R.F.",
  },
  description:
    "A social experiment that reveals the hidden dynamics of your friendship. Answer 8 dilemmas. Send the link. Discover your friendship matrix.",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Are We Really Friends?",
    title: "Are We Really Friends? — A Friendship Experiment",
    description:
      "A social experiment that reveals the hidden dynamics of your friendship. Answer 8 dilemmas. Send the link. Discover your friendship matrix.",
  },
  twitter: {
    card: "summary",
    title: "Are We Really Friends? — A Friendship Experiment",
    description:
      "A social experiment that reveals the hidden dynamics of your friendship. Answer 8 dilemmas. Send the link. Discover your friendship matrix.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
