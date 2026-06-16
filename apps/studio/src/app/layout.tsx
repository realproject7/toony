import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import "./tokens.css";
import "./studio.css";

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
