'use client';

import { usePathname } from 'next/navigation';

export default function Header() {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');

  if (isAdmin) {
    return (
      <header className="header">
        <h1 className="logo-text">⚙️ FITABLE予約管理システム</h1>
      </header>
    );
  }

  return (
    <header className="header">
      <div className="logo-container">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/header_banner.png" alt="FITABLE" className="header-logo-image" />
        <div className="header-subtext">予約システム</div>
      </div>
    </header>
  );
}
