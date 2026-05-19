'use client';

import { useState, useEffect } from 'react';

interface Store {
  店舗名: string;
  住所?: string;
  電話番号?: string;
  カレンダーID?: string;
  WebhookURL?: string;
  メール持ち物?: string;
  メール来店案内?: string;
  利用規約?: string;
  プラン名?: string;
  通常価格?: string;
  キャンペーン価格?: string;
  キャンペーン備考?: string;
}

interface Slot {
  time: string;
  max: number;
  booked: number;
  available: boolean;
  isPast: boolean;
}

interface DayData {
  date: string; // YYYY/MM/DD
  dayName: string; // 日, 月, 火...
  slots: Slot[];
}

export default function BookingPage() {
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [globalConfig, setGlobalConfig] = useState<any>(null);

  // 予約入力フォーム情報
  const [selectedStore, setSelectedStore] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');

  const [name, setName] = useState<string>('');
  const [kana, setKana] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [emailConfirm, setEmailConfirm] = useState<string>('');
  const [termsAgreed, setTermsAgreed] = useState<boolean>(false);
  const [itemsConfirmed, setItemsConfirmed] = useState<boolean>(false);

  // カレンダー関連
  const [weeklyCalendar, setWeeklyCalendar] = useState<DayData[]>([]);
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(new Date());
  const [calendarLoading, setCalendarLoading] = useState<boolean>(false);

  // 予約完了ID
  const [createdBookingId, setCreatedBookingId] = useState<string>('');

  // 1. 初期設定情報のロード
  useEffect(() => {
    async function loadConfig() {
      try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.stores) {
          setStores(data.stores);
        }
        if (data.config) {
          setGlobalConfig(data.config);
        }
      } catch (err) {
        console.error('Failed to load initial config:', err);
        alert('初期情報の読み込みに失敗しました。再読み込みしてください。');
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  // 2. 店舗選択時のカレンダー更新
  useEffect(() => {
    if (selectedStore) {
      loadWeeklySlots(selectedStore, currentWeekStart);
    }
  }, [selectedStore, currentWeekStart]);

  // 週の変更処理
  const changeWeek = (weeksOffset: number) => {
    const newStart = new Date(currentWeekStart.getTime() + weeksOffset * 7 * 24 * 60 * 60 * 1000);
    setCurrentWeekStart(newStart);
  };

  // カレンダーデータの取得
  const loadWeeklySlots = async (storeName: string, startDt: Date) => {
    setCalendarLoading(true);
    try {
      const y = startDt.getFullYear();
      const m = String(startDt.getMonth() + 1).padStart(2, '0');
      const d = String(startDt.getDate()).padStart(2, '0');
      const dateStr = `${y}/${m}/${d}`;

      const res = await fetch(`/api/calendar?store=${encodeURIComponent(storeName)}&startDate=${dateStr}`);
      if (res.ok) {
        const slotsData = await res.json();
        setWeeklyCalendar(slotsData);
      } else {
        alert('空き枠データの取得に失敗しました。');
      }
    } catch (err) {
      console.error('Error fetching calendar:', err);
      alert('カレンダー取得中にエラーが発生しました。');
    } finally {
      setCalendarLoading(false);
    }
  };

  // 選択している店舗の基本詳細を取得
  const getSelectedStoreInfo = (): Store | undefined => {
    return stores.find(s => s.店舗名 === selectedStore);
  };

  // 前のステップへ戻る
  const goToStep = (targetStep: number) => {
    setStep(targetStep);
  };

  // 個人情報入力フォームのバリデーションとステップ進行
  const handleSubmitPersonalInfo = (e: React.FormEvent) => {
    e.preventDefault();

    if (email !== emailConfirm) {
      alert('入力されたメールアドレスが確認用と一致しません。');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      alert('有効なメールアドレスを入力してください。');
      return;
    }

    const cleanPhone = phone.replace(/[\s\+\-]/g, '');
    const phoneRegex = /^[0-9]{8,20}$/;
    if (!phoneRegex.test(cleanPhone)) {
      alert('電話番号は8〜20桁の半角数字で入力してください。');
      return;
    }

    if (!termsAgreed) {
      alert('利用規約への同意が必要です。');
      return;
    }

    goToStep(5);
  };

  // 予約の最終登録処理
  const submitBooking = async () => {
    if (!itemsConfirmed) return;

    setLoading(true);
    try {
      const res = await fetch('/api/booking/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store: selectedStore,
          date: selectedDate,
          time: selectedTime,
          name,
          kana,
          phone,
          email,
        }),
      });

      const result = await res.json();
      if (result.success) {
        setCreatedBookingId(result.bookingId);
        setStep(6); // サンクスページ（Step Finish）へ
      } else {
        alert(result.error || '予約の登録に失敗しました。');
      }
    } catch (err) {
      console.error('Submit booking error:', err);
      alert('予約処理中に通信エラーが発生しました。時間を置いて再度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  // カレンダー日付文字列 (YYYY/MM/DD) の整形
  const formatShortDate = (dateStr: string) => {
    const parts = dateStr.split('/');
    if (parts.length < 3) return dateStr;
    return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
  };

  // 日付範囲表示用の文字列を作成
  const getWeeklyDateRangeStr = () => {
    if (weeklyCalendar.length === 0) return '';
    const first = weeklyCalendar[0].date;
    const last = weeklyCalendar[weeklyCalendar.length - 1].date;
    return `${first} ～ ${last}`;
  };

  if (loading && step < 6) {
    return (
      <div className="loading-overlay">
        <div className="spinner"></div>
        <p>読み込み中...</p>
      </div>
    );
  }

  const storeInfo = getSelectedStoreInfo();
  const planName = storeInfo?.プラン名 || globalConfig?.DEFAULT_PLAN_NAME || '体験トレーニング';
  const normalPrice = storeInfo?.通常価格 || globalConfig?.DEFAULT_NORMAL_PRICE || '';
  const campaignPrice = storeInfo?.キャンペーン価格 || globalConfig?.DEFAULT_CAMPAIGN_PRICE || '';
  const campaignMemo = storeInfo?.キャンペーン備考 || globalConfig?.DEFAULT_CAMPAIGN_MEMO || '';
  const termsText = storeInfo?.利用規約 || globalConfig?.DEFAULT_TERMS || '第1条（目的）\n本規約は、当ジムの体験利用に関する条件を定めるものです。';

  return (
    <>
      {/* 1. 店舗選択画面 */}
      {step === 1 && (
        <section className="step-section active">
          <h2 className="section-title">体験希望の店舗を選択</h2>
          <div className="store-grid">
            {stores.map((s, idx) => (
              <div
                key={idx}
                className="store-card"
                onClick={() => {
                  setSelectedStore(s.店舗名);
                  setCurrentWeekStart(new Date());
                  goToStep(2);
                }}
              >
                <h3>{s.店舗名}</h3>
                <div className="store-info-row">
                  <span className="store-info-label">住所</span>
                  <span>{s.住所 || '---'}</span>
                </div>
                <div className="store-info-row">
                  <span className="store-info-label">電話</span>
                  <span>{s.電話番号 || '---'}</span>
                </div>
              </div>
            ))}
            {stores.length === 0 && (
              <div className="text-center" style={{ padding: '40px' }}>
                登録されている店舗情報がありません。
              </div>
            )}
          </div>
        </section>
      )}

      {/* 2. 店舗・日時選択画面 */}
      {step === 2 && (
        <section className="step-section active">
          <div className="step-header">
            <button className="back-btn" onClick={() => goToStep(1)}>← 戻る</button>
            <h2 className="section-title">日時を選択</h2>
          </div>

          <div className="form-group">
            <label htmlFor="store-select">店舗</label>
            <select
              id="store-select"
              className="form-control"
              value={selectedStore}
              onChange={(e) => {
                setSelectedStore(e.target.value);
                setCurrentWeekStart(new Date());
              }}
            >
              {stores.map((s, idx) => (
                <option key={idx} value={s.店舗名}>
                  {s.店舗名}
                </option>
              ))}
            </select>
          </div>

          <div id="weekly-calendar-container" style={{ marginTop: '20px' }}>
            <div className="weekly-nav">
              <button className="nav-btn" onClick={() => changeWeek(-1)}>◀ 前週</button>
              <h3>{getWeeklyDateRangeStr()}</h3>
              <button className="nav-btn" onClick={() => changeWeek(1)}>次週 ▶</button>
            </div>

            {calendarLoading ? (
              <div className="text-center" style={{ padding: '60px', background: 'white', border: '1px solid #eaeaea', borderTop: 'none' }}>
                <div className="spinner" style={{ margin: '0 auto 10px auto' }}></div>
                <p style={{ fontSize: '14px', color: 'var(--text-sub)' }}>空き状況を計算中...</p>
              </div>
            ) : (
              <div className="weekly-grid-wrapper">
                <div className="weekly-grid">
                  {weeklyCalendar.map((day, dIdx) => (
                    <div className="wc-col" key={dIdx}>
                      <div className={`wc-header ${day.dayName === '土' ? 'sat' : day.dayName === '日' ? 'sun' : day.dayName === '祝' ? 'holiday' : ''}`}>
                        {formatShortDate(day.date)} ({day.dayName})
                      </div>
                      
                      {day.slots.length === 0 ? (
                        <div style={{ padding: '20px 0', fontSize: '11px', textAlign: 'center', color: '#999' }}>
                          定休日
                        </div>
                      ) : (
                        day.slots.map((slot, sIdx) => (
                          <div className="wc-slot" key={sIdx}>
                            <div className="wc-time">{slot.time}</div>
                            
                            {slot.available ? (
                              <>
                                <div className="wc-remain available">空きあり</div>
                                <button
                                  className="wc-btn"
                                  onClick={() => {
                                    setSelectedDate(day.date);
                                    setSelectedTime(slot.time);
                                    goToStep(3);
                                  }}
                                >
                                  選択する
                                </button>
                              </>
                            ) : (
                              <>
                                <div className="wc-remain unavailable">満席</div>
                                <button className="wc-btn disabled" disabled>ー</button>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 3. プラン・金額確認画面 */}
      {step === 3 && (
        <section className="step-section active">
          <div className="step-header">
            <button className="back-btn" onClick={() => goToStep(2)}>← 戻る</button>
            <h2 className="section-title">プランとお支払い</h2>
          </div>

          <div className="price-card">
            <h3>{planName}</h3>
            
            <div className="price-row">
              {campaignPrice && campaignPrice !== 'なし' && campaignPrice !== '0' ? (
                <>
                  <div className="price-item">
                    <span className="price-label">通常料金</span>
                    <span className="original-price">{normalPrice}</span>
                  </div>
                  <div className="price-item">
                    <span className="price-label highlight-label">体験キャンペーン料金</span>
                    <span className="campaign-price">
                      <span className="highlight">{campaignPrice}</span>
                    </span>
                  </div>
                </>
              ) : (
                <div className="price-item">
                  <span className="price-label">料金</span>
                  <span className="campaign-price">
                    <span className="highlight">{normalPrice}</span>
                  </span>
                </div>
              )}
            </div>

            {campaignMemo && (
              <div className="campaign-memo-box mt-4">
                <p style={{ whiteSpace: 'pre-wrap' }}>{campaignMemo}</p>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>お支払い方法</label>
            <div className="radio-label">
              <input type="radio" name="payment" value="onsite" checked readOnly />
              <span>当日ジムにて精算（無料の場合は0円）</span>
            </div>
          </div>

          <button className="primary-btn mt-4" onClick={() => goToStep(4)}>
            次へ進む
          </button>
        </section>
      )}

      {/* 4. お客様情報入力・規約同意 */}
      {step === 4 && (
        <section className="step-section active">
          <div className="step-header">
            <button className="back-btn" onClick={() => goToStep(3)}>← 戻る</button>
            <h2 className="section-title">お客様情報の入力</h2>
          </div>

          <form onSubmit={handleSubmitPersonalInfo}>
            <div className="form-group">
              <label htmlFor="name">氏名 <span className="badge">必須</span></label>
              <input
                type="text"
                id="name"
                className="form-control"
                required
                placeholder="山田 太郎"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="kana">フリガナ <span className="badge">必須</span></label>
              <input
                type="text"
                id="kana"
                className="form-control"
                required
                placeholder="ヤマダ タロウ"
                value={kana}
                onChange={(e) => setKana(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="phone">電話番号 <span className="badge">必須</span></label>
              <input
                type="tel"
                id="phone"
                className="form-control"
                required
                placeholder="090-1234-5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">メールアドレス <span className="badge">必須</span></label>
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

            <div className="form-group">
              <label htmlFor="email-confirm">メールアドレス（確認用） <span className="badge">必須</span></label>
              <input
                type="email"
                id="email-confirm"
                className="form-control"
                required
                placeholder="もう一度入力してください"
                value={emailConfirm}
                onChange={(e) => setEmailConfirm(e.target.value)}
              />
            </div>

            <div className="terms-box" style={{ whiteSpace: 'pre-wrap' }}>
              <h4>体験時利用規約</h4>
              <p>{termsText}</p>
            </div>

            <label className="checkbox-label">
              <input
                type="checkbox"
                id="terms"
                required
                checked={termsAgreed}
                onChange={(e) => setTermsAgreed(e.target.checked)}
              />
              <span>利用規約に同意する</span>
            </label>

            <button type="submit" className="primary-btn mt-4">
              予約内容の確認へ
            </button>
          </form>
        </section>
      )}

      {/* 5. 予約内容確認画面 */}
      {step === 5 && (
        <section className="step-section active">
          <div className="step-header">
            <button className="back-btn" onClick={() => goToStep(4)}>← 戻る</button>
            <h2 className="section-title">ご予約内容の確認</h2>
          </div>

          <h3 className="subsection-title">お客様情報</h3>
          <div className="summary-card" style={{ marginBottom: '24px' }}>
            <dl className="summary-list">
              <dt>氏名</dt>
              <dd>{name}</dd>
              <dt>電話番号</dt>
              <dd>{phone}</dd>
              <dt>メールアドレス</dt>
              <dd>{email}</dd>
            </dl>
          </div>

          <h3 className="subsection-title">ご予約内容</h3>
          <div className="summary-card" style={{ marginBottom: '24px' }}>
            <dl className="summary-list">
              <dt>体験店舗</dt>
              <dd>{selectedStore}</dd>
              <dt>ご来店日時</dt>
              <dd>{selectedDate} {selectedTime}</dd>
              <dt>ご予約プラン</dt>
              <dd>{planName} ({campaignPrice && campaignPrice !== 'なし' && campaignPrice !== '0' ? campaignPrice : normalPrice})</dd>
            </dl>
          </div>

          <h3 className="subsection-title">確認事項</h3>
          <div className="summary-card">
            <dl className="summary-list">
              <dt>当日の持ち物案内</dt>
              <dd style={{ whiteSpace: 'pre-wrap', fontSize: '14px', fontWeight: 'normal', borderBottom: 'none' }}>
                {storeInfo?.メール持ち物 || globalConfig?.DEFAULT_EMAIL_ITEMS || '室内シューズ・水分・動きやすい服装'}
              </dd>
              <dt style={{ marginTop: '16px' }}>ご来店にあたって</dt>
              <dd style={{ whiteSpace: 'pre-wrap', fontSize: '14px', fontWeight: 'normal', borderBottom: 'none' }}>
                {storeInfo?.メール来店案内 || globalConfig?.DEFAULT_EMAIL_VISIT || 'ご予約の10分前にお越しください'}
              </dd>
            </dl>

            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed var(--border-color)' }}>
              <label className="checkbox-label" style={{ border: 'none', padding: 0, background: 'transparent' }}>
                <input
                  type="checkbox"
                  id="confirm-items-check"
                  checked={itemsConfirmed}
                  onChange={(e) => setItemsConfirmed(e.target.checked)}
                />
                <span style={{ fontWeight: 'bold', color: 'var(--primary-color)' }}>
                  上記内容（持ち物・来店案内）を確認しました
                </span>
              </label>
            </div>
          </div>

          <button
            className="primary-btn mt-4"
            onClick={submitBooking}
            disabled={!itemsConfirmed}
          >
            予約を確定する
          </button>
        </section>
      )}

      {/* 6. 完了画面（サンクスページ） */}
      {step === 6 && (
        <section className="step-section active">
          <div className="finish-card text-center" style={{ padding: '40px 0' }}>
            <span style={{ fontSize: '64px', display: 'block', marginBottom: '20px' }}>🎉</span>
            <h2 className="section-title" style={{ marginBottom: '12px' }}>ご予約完了</h2>
            <p style={{ color: 'var(--text-sub)', fontSize: '15px' }}>
              ご入力いただいたメールアドレスに詳細メールをお送りしました。
            </p>

            <div className="booking-id-box">
              <p>予約番号</p>
              <h3>{createdBookingId}</h3>
            </div>

            <p style={{ fontSize: '14px', color: 'var(--text-main)', marginTop: '24px' }}>
              体験のご予約ありがとうございます！当日はお気をつけてお越しください。<br />
              スタッフ一同、楽しみにお待ちしております！
            </p>

            <button
              className="primary-btn outline mt-4"
              style={{ width: '200px', margin: '32px auto 0 auto' }}
              onClick={() => {
                setName('');
                setKana('');
                setPhone('');
                setEmail('');
                setEmailConfirm('');
                setTermsAgreed(false);
                setItemsConfirmed(false);
                setSelectedStore('');
                goToStep(1);
              }}
            >
              トップへ戻る
            </button>
          </div>
        </section>
      )}
    </>
  );
}
