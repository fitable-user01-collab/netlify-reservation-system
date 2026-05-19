import './globals.css';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'FITABLE 体験予約システム',
  description: 'FITABLEの無料体験トレーニングをオンラインで簡単にご予約いただけます。',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <div className="app-container">
          <header className="header">
            <h1 className="logo-text">FITABLE 予約</h1>
          </header>
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
