import type { Metadata } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";
import "./globals.css";

/**
 * Braille Institute, drawn so characters cannot be confused with one another.
 *
 * Not decoration: Usher syndrome — congenital deafness with progressive vision
 * loss — is a significant population within relay's users, and captions are
 * this product's accessibility surface.
 */
const hyperlegible = Atkinson_Hyperlegible({
  variable: "--font-hyper",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aloud",
  description:
    "Place a phone call without a stranger in it. You type; your words are spoken aloud, verbatim, and the receipt proves it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${hyperlegible.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
