import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backlink Autofill 2.0",
  description: "Manage Business Profiles for Backlink Autofill.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
