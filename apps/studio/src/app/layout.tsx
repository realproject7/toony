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
