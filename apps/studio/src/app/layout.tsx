import type { ReactNode } from "react";
import { AgentWorkspace } from "@/components/agent-workspace";
import { LiveProvider } from "@/lib/live/provider";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./tokens.css";
import "./studio.css";
import "./agent-workspace.css";
import "./episode-editor.css";
// Self-hosted @font-face for the curated lettering faces (served from
// /public/fonts, no CDN). Generated from the @toony/fonts registry so the SVG
// preview/editor render the SAME faces the export canvas registers (#56).
import "./lettering-fonts.css";

export const metadata = {
  // Pages name themselves ("Story · <title>"); the template adds the product.
  title: { default: "Toony", template: "%s · Toony" },
  description: "Make webtoons with your own AI agent.",
  // Brand mark (v4): the operator's Toony tuxedo-cat icon. Served from /public
  // so the real favicon/app icon load.
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
    // The head script sets `data-theme` before the first paint, so the server
    // markup and the browser differ on purpose for that one attribute.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed, Studio-authored theme script must run before paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <LiveProvider>
          <AgentWorkspace>{children}</AgentWorkspace>
        </LiveProvider>
      </body>
    </html>
  );
}
