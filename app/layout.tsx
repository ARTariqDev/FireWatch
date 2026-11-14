import type { Metadata } from "next";
import { preconnect } from "react-dom";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Firewatch — See the heat before the horizon",
  description:
    "Firewatch brings MODIS and VIIRS thermal intelligence into focus, revealing emerging fire signals before they reach the horizon.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The map's style, tiles and fonts all come from here; opening the connection early hides its setup time.
  preconnect("https://api.mapbox.com", { crossOrigin: "anonymous" });

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <head>
        <link rel="stylesheet" href="/mapbox-gl.css" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
