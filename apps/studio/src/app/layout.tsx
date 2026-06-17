import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import "./tokens.css";
import "./studio.css";
// Self-hosted @font-face for the curated lettering faces (served from
// /public/fonts, no CDN). Generated from the @toony/fonts registry so the SVG
// preview/editor render the SAME faces the export canvas registers (#56).
import "./lettering-fonts.css";

export const metadata = {
  title: "Toony Studio",
  description: "Local-first webtoon production studio",
  // Brand mark (Studio Pulse): indigo webtoon scroll + Pulse Coral speech
  // bubble. Served from /public so the real favicon/app icon load.
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon.png", type: "image/png", sizes: "64x64" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-frame">
          <Sidebar />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
