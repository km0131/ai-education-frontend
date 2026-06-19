import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI わくわく教室 - はじめての AI",
  description: "AI（エーアイ）といっしょに、楽しくプログラミングやパソコンを学べるよ！",
  icons: {
    icon: 'icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
