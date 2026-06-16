import type { ReactNode } from "react";

export const metadata = {
  title: "Toony Studio",
  description: "Local-first webtoon production studio",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "2rem",
          lineHeight: 1.5,
        }}
      >
        {children}
      </body>
    </html>
  );
}
