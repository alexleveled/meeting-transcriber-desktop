import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RecorderProvider } from "@/components/RecorderProvider";
import { AppFrame } from "@/components/AppFrame";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meeting Transcriber",
  description: "Granola-style real-time dual-stream meeting transcription",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <RecorderProvider>
          <AppFrame>{children}</AppFrame>
        </RecorderProvider>
      </body>
    </html>
  );
}
