import './globals.css';
import { Metadata } from 'next';
import Header from './components/Header';

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
          <Header />
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

