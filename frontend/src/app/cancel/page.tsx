'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function CancelPage() {
  const [bookingId, setBookingId] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);
  const [clientName, setClientName] = useState<string>('');

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bookingId.trim() || !email.trim()) {
      alert('予約番号とメールアドレスを入力してください。');
      return;
    }

    if (bookingId.trim().length !== 6) {
      alert('予約番号は6文字の英数字です。');
      return;
    }

    const confirmCancel = window.confirm('本当にこのご予約をキャンセルしてもよろしいですか？');
    if (!confirmCancel) return;

    setLoading(false);
    setLoading(true);

    try {
      const res = await fetch('/api/booking/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: bookingId.toUpperCase().trim(),
          email: email.trim(),
        }),
      });

      const result = await res.json();
      if (result.success) {
        setClientName(result.name || '');
        setSuccess(true);
      } else {
        alert(result.error || 'キャンセルの実行に失敗しました。予約番号やメールアドレスが一致しているかご確認ください。');
      }
    } catch (err) {
      console.error('Cancel booking error:', err);
      alert('キャンセル処理中に通信エラーが発生しました。時間を置いて再度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner"></div>
        <p>キャンセル処理を実行中...</p>
      </div>
    );
  }

  return (
    <section className="step-section active">
      <div className="step-header">
        <Link href="/" className="back-btn">← 予約トップへ</Link>
        <h2 className="section-title">予約のキャンセル</h2>
      </div>

      {success ? (
        <div className="finish-card text-center" style={{ padding: '40px 0' }}>
          <span style={{ fontSize: '64px', display: 'block', marginBottom: '20px' }}>✉️</span>
          <h2 className="section-title" style={{ marginBottom: '12px', color: '#ff3b30' }}>キャンセル完了</h2>
          <p style={{ color: 'var(--text-sub)', fontSize: '15px', marginBottom: '24px' }}>
            ご予約のキャンセル手続きが正常に完了しました。
          </p>

          <div className="booking-id-box" style={{ background: '#fff2f2', borderColor: '#ff3b30' }}>
            <p style={{ color: '#ff3b30' }}>対象の予約番号</p>
            <h3 style={{ color: '#ff3b30' }}>{bookingId.toUpperCase()}</h3>
          </div>

          <p style={{ fontSize: '14px', color: 'var(--text-main)', marginTop: '24px' }}>
            {clientName ? `${clientName} 様、` : ''}ご予約のキャンセルを承りました。<br />
            またのご体験のご予約を心よりお待ちしております。
          </p>

          <Link
            href="/"
            className="primary-btn outline mt-4"
            style={{ width: '220px', margin: '32px auto 0 auto', display: 'block' }}
          >
            予約ページへ戻る
          </Link>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: '14px', color: 'var(--text-sub)', marginBottom: '24px' }}>
            体験予約をキャンセルする場合は、ご予約時に発行された「予約番号（6桁）」と「メールアドレス」を入力してください。
          </p>

          <form onSubmit={handleCancel}>
            <div className="form-group">
              <label htmlFor="booking-id">予約番号（英数字6桁） <span className="badge">必須</span></label>
              <input
                type="text"
                id="booking-id"
                className="form-control"
                required
                maxLength={6}
                placeholder="例: ABC890"
                style={{ textTransform: 'uppercase' }}
                value={bookingId}
                onChange={(e) => setBookingId(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">登録メールアドレス <span className="badge">必須</span></label>
              <input
                type="email"
                id="email"
                className="form-control"
                required
                placeholder="example@mail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="primary-btn mt-4"
              style={{ background: 'linear-gradient(135deg, #ff7e7e 0%, #ff3b30 100%)', boxShadow: '0 6px 20px rgba(255, 59, 48, 0.2)' }}
            >
              ご予約をキャンセルする
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
