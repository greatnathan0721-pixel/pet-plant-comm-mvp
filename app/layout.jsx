export const metadata = {
  title: "Pets & Plants MVP",
  description: "Minimal Next.js app with /api/chat",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
