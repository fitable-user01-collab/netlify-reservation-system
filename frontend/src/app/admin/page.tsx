'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

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

interface DaySetting {
  day: string;
  active: boolean;
  start: string;
  end: string;
  breakStart: string;
  breakEnd: string;
  maxSlots: number;
}

export default function AdminPage() {
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);
  const [pinInput, setPinInput] = useState<string>('');
  const [authPin, setAuthPin] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // 管理画面タブ ('calendar' | 'schedule' | 'stores' | 'system')
  const [activeTab, setActiveTab] = useState<string>('calendar');
  const [selectedStore, setSelectedStore] = useState<string>('');

  // データベース保存用と編集用のステート（リバート機能のため別々に保持）
  const [stores, setStores] = useState<Store[]>([]);
  const [editStores, setEditStores] = useState<Store[]>([]);

  const [globalConfig, setGlobalConfig] = useState<any>(null);
  const [editGlobalConfig, setEditGlobalConfig] = useState<any>(null);

  const [settings, setSettings] = useState<DaySetting[]>([]);
  const [editSettings, setEditSettings] = useState<DaySetting[]>([]);

  const [holidays, setHolidays] = useState<string[]>([]);
  const [editHolidays, setEditHolidays] = useState<string[]>([]);
  const [newHolidayInput, setNewHolidayInput] = useState<string>('');

  // 予約管理（カレンダー）関連
  const [reservations, setReservations] = useState<any[]>([]);
  const [yearMonth, setYearMonth] = useState<string>(''); // YYYY-MM形式
  const [selectedDate, setSelectedDate] = useState<string>(''); // YYYY/MM/DD形式

  // 変更検知フラグ
  const [isDirtySettings, setIsDirtySettings] = useState<boolean>(false);
  const [isDirtyStores, setIsDirtyStores] = useState<boolean>(false);
  const [isDirtySystem, setIsDirtySystem] = useState<boolean>(false);

  // 1. カレンダー初期日付の設定
  useEffect(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    setYearMonth(`${y}-${m}`);
  }, []);

  // 2. 認証後のマスターデータ初期取得
  useEffect(() => {
    if (isAuthorized) {
      loadMasterConfig();
    }
  }, [isAuthorized]);

  // 3. 店舗切り替えや年月切り替え時のデータロード
  useEffect(() => {
    if (isAuthorized && selectedStore) {
      loadStoreSettingsAndHolidays(selectedStore);
      loadReservations(selectedStore, yearMonth);
    }
  }, [isAuthorized, selectedStore, yearMonth]);

  // 全体設定と店舗一覧のロード
  const loadMasterConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (data.stores) {
        setStores(data.stores);
        setEditStores(JSON.parse(JSON.stringify(data.stores)));
        if (data.stores.length > 0 && !selectedStore) {
          setSelectedStore(data.stores[0].店舗名);
        }
      }
      if (data.config) {
        setGlobalConfig(data.config);
        setEditGlobalConfig(JSON.parse(JSON.stringify(data.config)));
      }
    } catch (err) {
      console.error('Failed to load master configuration:', err);
      alert('マスタ情報の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  // 店舗のスケジュール設定と休日の取得
  const loadStoreSettingsAndHolidays = async (storeName: string) => {
    try {
      const res = await fetch(`/api/admin/save-settings?store=${encodeURIComponent(storeName)}&authPin=${authPin}`);
      const data = await res.json();
      if (res.ok) {
        setSettings(data.settings);
        setEditSettings(JSON.parse(JSON.stringify(data.settings)));
        setHolidays(data.holidays);
        setEditHolidays([...data.holidays]);
        setIsDirtySettings(false);
      } else {
        alert(data.error || '店舗設定の取得に失敗しました。');
      }
    } catch (err) {
      console.error('Failed to load store settings:', err);
    }
  };

  // 指定年月の予約リスト取得
  const loadReservations = async (storeName: string, ym: string) => {
    if (!storeName || !ym) return;
    try {
      const res = await fetch(`/api/admin/reservations?store=${encodeURIComponent(storeName)}&yearMonth=${ym}&authPin=${authPin}`);
      const data = await res.json();
      if (res.ok) {
        setReservations(data);
      } else {
        console.error('Failed to load reservations:', data.error);
      }
    } catch (err) {
      console.error('Failed to fetch reservations:', err);
    }
  };

  // PIN認証処理
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      const data = await res.json();
      if (data.success) {
        setAuthPin(pinInput);
        setIsAuthorized(true);
      } else {
        alert(data.error || 'PINコードが正しくありません。');
      }
    } catch (err) {
      console.error('Auth error:', err);
      alert('認証通信中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  // 変更の破棄（リバート）処理 (c8fdc189用)
  const revertChanges = (tabName: string) => {
    if (tabName === 'schedule') {
      setEditSettings(JSON.parse(JSON.stringify(settings)));
      setEditHolidays([...holidays]);
      setNewHolidayInput('');
      setIsDirtySettings(false);
    } else if (tabName === 'stores') {
      setEditStores(JSON.parse(JSON.stringify(stores)));
      setIsDirtyStores(false);
    } else if (tabName === 'system') {
      setEditGlobalConfig(JSON.parse(JSON.stringify(globalConfig)));
      setIsDirtySystem(false);
    }
  };

  // タブの切り替え (切り替え時に未保存データを自動リバート)
  const handleTabSwitch = (newTab: string) => {
    if (newTab === activeTab) return;

    // 未保存の変更があれば自動で破棄する
    if (activeTab === 'schedule' && isDirtySettings) {
      revertChanges('schedule');
    } else if (activeTab === 'stores' && isDirtyStores) {
      revertChanges('stores');
    } else if (activeTab === 'system' && isDirtySystem) {
      revertChanges('system');
    }

    setActiveTab(newTab);
  };

  // 店舗の切り替え (切り替え時に未保存データを自動リバート)
  const handleStoreSwitch = (newStoreName: string) => {
    if (newStoreName === selectedStore) return;

    if (isDirtySettings) revertChanges('schedule');
    if (isDirtyStores) revertChanges('stores');

    setSelectedStore(newStoreName);
  };

  // ==========================================
  // 保存処理 (API送信)
  // ==========================================

  // スケジュール設定・休日設定の保存
  const saveScheduleSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/save-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authPin,
          store: selectedStore,
          settings: editSettings,
          holidays: editHolidays
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('スケジュール・休日設定を保存しました。');
        setSettings(JSON.parse(JSON.stringify(editSettings)));
        setHolidays([...editHolidays]);
        setIsDirtySettings(false);
      } else {
        alert(data.error || '保存に失敗しました。');
      }
    } catch (err) {
      console.error('Save settings error:', err);
      alert('保存処理中に通信エラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  // 店舗基本情報の保存
  const saveStoreBasicInfos = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/save-stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authPin,
          stores: editStores
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('店舗情報を保存しました。');
        setStores(JSON.parse(JSON.stringify(editStores)));
        setIsDirtyStores(false);
      } else {
        alert(data.error || '保存に失敗しました。');
      }
    } catch (err) {
      console.error('Save stores error:', err);
      alert('保存処理中に通信エラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  // システム設定の保存
  const saveSystemConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/save-system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authPin,
          config: editGlobalConfig
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('システム設定を保存しました。PINコードを変更した場合は次回ログイン時より新しいコードが適用されます。');
        setGlobalConfig(JSON.parse(JSON.stringify(editGlobalConfig)));
        setIsDirtySystem(false);
      } else {
        alert(data.error || '保存に失敗しました。');
      }
    } catch (err) {
      console.error('Save system error:', err);
      alert('保存処理中に通信エラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  // 予約キャンセル実行（管理者によるワンクリック削除）
  const executeAdminCancel = async (bookingId: string) => {
    const confirmCancel = window.confirm(`予約番号 [${bookingId}] の予約をキャンセルします。よろしいですか？（Googleカレンダーからも削除されます）`);
    if (!confirmCancel) return;

    setLoading(true);
    try {
      const res = await fetch('/api/booking/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          authPin
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('予約をキャンセルしました。');
        loadReservations(selectedStore, yearMonth);
      } else {
        alert(data.error || 'キャンセル処理に失敗しました。');
      }
    } catch (err) {
      console.error('Cancel booking error:', err);
      alert('キャンセル実行中に通信エラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // カレンダーセル計算関連
  // ==========================================
  const renderAdminCalendarCells = () => {
    if (!yearMonth) return null;
    const [year, month] = yearMonth.split('-').map(Number);
    
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);

    const firstDayOfWeek = firstDay.getDay(); // 0 (日) ～ 6 (土)
    const totalDays = lastDay.getDate();

    const cells = [];
    
    // 空白セル（前月分）
    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push(<td key={`empty-${i}`} className="empty-cell"></td>);
    }

    // 今月のセル
    for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
      const dateStr = `${year}/${String(month).padStart(2, '0')}/${String(dayNum).padStart(2, '0')}`;
      
      // 当該日の予約をフィルタ
      const dayBookings = reservations.filter(r => r.date === dateStr);
      
      const isToday = new Date().toLocaleDateString('ja-JP') === new Date(year, month - 1, dayNum).toLocaleDateString('ja-JP');
      const isSelected = selectedDate === dateStr;

      // 店舗休館日リストに入っているか
      const isHoliday = holidays.includes(dateStr);

      cells.push(
        <td
          key={`day-${dayNum}`}
          className={`${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isHoliday ? 'holiday-cell' : ''}`}
          onClick={() => setSelectedDate(dateStr)}
        >
          <div className="cal-day-num">
            {dayNum}
            {isHoliday && <span style={{ fontSize: '9px', marginLeft: '4px', color: '#ff3b30', fontWeight: 'bold' }}>(休)</span>}
          </div>
          <div className="cal-booking-dots">
            {dayBookings.slice(0, 2).map((b, idx) => (
              <span key={idx} className="cal-dot" title={`${b.time} ${b.name}様`}>
                {b.time.split('～')[0]} {b.name.substring(0, 3)}
              </span>
            ))}
            {dayBookings.length > 2 && (
              <span className="cal-dot" style={{ background: '#eee', color: '#666', textAlign: 'center' }}>
                他{dayBookings.length - 2}件
              </span>
            )}
          </div>
        </td>
      );
    }

    // 行（週）ごとに分割
    const rows = [];
    let cellsInWeek = [];

    for (let i = 0; i < cells.length; i++) {
      cellsInWeek.push(cells[i]);
      if (cellsInWeek.length === 7 || i === cells.length - 1) {
        // 最終週の残りを空白で埋める
        if (i === cells.length - 1 && cellsInWeek.length < 7) {
          const remain = 7 - cellsInWeek.length;
          for (let j = 0; j < remain; j++) {
            cellsInWeek.push(<td key={`empty-end-${j}`} className="empty-cell"></td>);
          }
        }
        rows.push(<tr key={`row-${rows.length}`}>{cellsInWeek}</tr>);
        cellsInWeek = [];
      }
    }

    return rows;
  };

  // ==========================================
  // インプット変更ハンドラー（Dirtyフラグ制御）
  // ==========================================

  // スケジュール時間の変更
  const handleSettingTimeChange = (index: number, field: keyof DaySetting, val: any) => {
    const updated = [...editSettings];
    updated[index] = {
      ...updated[index],
      [field]: val
    };
    setEditSettings(updated);
    setIsDirtySettings(true);
  };

  // スケジュール営業チェックボックス変更
  const handleSettingActiveChange = (index: number, checked: boolean) => {
    const updated = [...editSettings];
    updated[index] = {
      ...updated[index],
      active: checked
    };
    setEditSettings(updated);
    setIsDirtySettings(true);
  };

  // スケジュール同時定員の変更
  const handleSettingMaxSlotsChange = (index: number, val: number) => {
    const updated = [...editSettings];
    updated[index] = {
      ...updated[index],
      maxSlots: val
    };
    setEditSettings(updated);
    setIsDirtySettings(true);
  };

  // 休日の追加
  const addCustomHoliday = () => {
    const datePattern = /^[0-9]{4}\/[0-9]{2}\/[0-9]{2}$/;
    if (!datePattern.test(newHolidayInput)) {
      alert('休館日は YYYY/MM/DD 形式で入力してください。 (例: 2026/05/20)');
      return;
    }

    if (editHolidays.includes(newHolidayInput)) {
      alert('その日はすでに休館日リストに存在します。');
      return;
    }

    setEditHolidays([...editHolidays, newHolidayInput].sort());
    setNewHolidayInput('');
    setIsDirtySettings(true);
  };

  // 休日の削除
  const removeCustomHoliday = (dateStr: string) => {
    setEditHolidays(editHolidays.filter(h => h !== dateStr));
    setIsDirtySettings(true);
  };

  // 店舗基本詳細情報の変更
  const handleStoreDetailChange = (storeIndex: number, field: keyof Store, val: string) => {
    const updated = [...editStores];
    updated[storeIndex] = {
      ...updated[storeIndex],
      [field]: val
    };
    setEditStores(updated);
    setIsDirtyStores(true);
  };

  // 店舗の追加
  const addNewStore = () => {
    const name = window.prompt('追加する新しい店舗名を入力してください。 (例: FITABLE桂店)');
    if (!name || !name.trim()) return;
    
    if (editStores.some(s => s.店舗名 === name.trim())) {
      alert('すでに同じ名前の店舗が存在します。');
      return;
    }

    const newStoreObj: Store = {
      店舗名: name.trim(),
      住所: '',
      電話番号: '',
      カレンダーID: 'primary',
      WebhookURL: '',
      メール持ち物: '',
      メール来店案内: '',
      利用規約: '',
      プラン名: '体験トレーニング',
      通常価格: '5,500円(税込)',
      キャンペーン価格: '0円',
      キャンペーン備考: '当日入会で体験料キャッシュバックキャンペーン中！'
    };

    setEditStores([...editStores, newStoreObj]);
    setIsDirtyStores(true);
  };

  // 店舗の削除
  const deleteStore = (storeName: string) => {
    const confirmDel = window.confirm(`店舗 [${storeName}] を削除します。この店舗に属する設定データも削除されますが、本当によろしいですか？`);
    if (!confirmDel) return;

    setEditStores(editStores.filter(s => s.店舗名 !== storeName));
    setIsDirtyStores(true);
  };

  // グローバルシステム設定の変更
  const handleSystemConfigChange = (key: string, val: string) => {
    setEditGlobalConfig({
      ...editGlobalConfig,
      [key]: val
    });
    setIsDirtySystem(true);
  };

  if (loading && !isAuthorized) {
    return (
      <div className="loading-overlay">
        <div className="spinner"></div>
        <p>管理者画面を読込中...</p>
      </div>
    );
  }

  // 認証前画面
  if (!isAuthorized) {
    return (
      <section className="step-section active" style={{ maxWidth: '400px', margin: '40px auto' }}>
        <div className="finish-card text-center" style={{ padding: '20px 0' }}>
          <span style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>🔒</span>
          <h2 className="section-title" style={{ marginBottom: '16px' }}>管理者ログイン</h2>
        </div>

        <form onSubmit={handleAuth}>
          <div className="form-group">
            <label htmlFor="admin-pin">管理者暗証番号 (PIN)</label>
            <input
              type="password"
              id="admin-pin"
              className="form-control"
              required
              placeholder="PINを入力"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
            />
          </div>
          <button type="submit" className="primary-btn mt-4">
            認証する
          </button>
        </form>
      </section>
    );
  }

  // 認証後の本体画面
  const selectedDateBookings = reservations.filter(r => r.date === selectedDate);
  const dirtyFlag = (activeTab === 'schedule' && isDirtySettings) ||
                     (activeTab === 'stores' && isDirtyStores) ||
                     (activeTab === 'system' && isDirtySystem);

  return (
    <section className="step-section active" style={{ maxWidth: '800px', margin: '0 auto' }}>
      
      {/* 1. 固定管理者コントロールヘッダー */}
      <div className="sticky-admin-bar">
        <div className="sticky-admin-bar-header">
          <h2 className="section-title">
            ⚙️ FITABLE 管理システム
          </h2>
          <button
            className="back-btn"
            style={{ color: '#e74c3c' }}
            onClick={() => {
              setIsAuthorized(false);
              setAuthPin('');
              setPinInput('');
            }}
          >
            ログアウト
          </button>
        </div>

        {/* 店舗切替ドロップダウン */}
        <div className="sticky-admin-actions">
          <label htmlFor="admin-store-select" style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-sub)' }}>
            操作対象店舗:
          </label>
          <select
            id="admin-store-select"
            className="form-control"
            style={{ width: '220px', padding: '8px', fontSize: '14px' }}
            value={selectedStore}
            onChange={(e) => handleStoreSwitch(e.target.value)}
          >
            {stores.map((s, idx) => (
              <option key={idx} value={s.店舗名}>
                {s.店舗名}
              </option>
            ))}
          </select>

          {/* 未保存時の脈動警告バッジ */}
          {dirtyFlag && (
            <span className="dirty-warning">
              ⚠️ 未保存の変更があります！
            </span>
          )}
        </div>
      </div>

      {/* 2. タブメニュー選択 */}
      <div className="admin-tab-menu">
        <button
          className={`admin-tab-btn ${activeTab === 'calendar' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('calendar')}
        >
          📅 予約カレンダー
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'schedule' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('schedule')}
        >
          ⏰ スケジュール枠・休日
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'stores' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('stores')}
        >
          🏢 店舗詳細・メール案内
        </button>
        <button
          className={`admin-tab-btn ${activeTab === 'system' ? 'active' : ''}`}
          onClick={() => handleTabSwitch('system')}
        >
          💻 システム全体設定
        </button>
      </div>

      {/* 3. 各タブコンテンツのレンダリング */}

      {/* タブA. 予約状況カレンダー */}
      {activeTab === 'calendar' && (
        <div>
          <div className="calendar-controls">
            <input
              type="month"
              className="form-control"
              style={{ width: '200px', padding: '6px' }}
              value={yearMonth}
              onChange={(e) => {
                setYearMonth(e.target.value);
                setSelectedDate('');
              }}
            />
            <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>
              予約件数: {reservations.length} 件
            </h3>
          </div>

          <table className="admin-calendar-table">
            <thead>
              <tr>
                <th style={{ color: '#ff3b30' }}>日</th>
                <th>月</th>
                <th>火</th>
                <th>水</th>
                <th>木</th>
                <th>金</th>
                <th style={{ color: '#007aff' }}>土</th>
              </tr>
            </thead>
            <tbody>
              {renderAdminCalendarCells()}
            </tbody>
          </table>

          {/* 選択日付の予約内訳リスト */}
          <div className="summary-card mt-4" style={{ background: '#fff' }}>
            <h3 style={{ fontSize: '15px', color: 'var(--primary-color)', borderBottom: '2px solid var(--primary-color)', paddingBottom: '6px', marginBottom: '12px' }}>
              🎯 {selectedDate ? `${selectedDate} の予約リスト` : 'カレンダーの日付を選択してください'}
            </h3>

            {selectedDate && selectedDateBookings.length === 0 && (
              <p className="text-center" style={{ color: 'var(--text-sub)', padding: '20px' }}>
                この日の体験予約はありません。
              </p>
            )}

            {selectedDate && selectedDateBookings.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {selectedDateBookings.map((b, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: '#faf9f6'
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '15px' }}>{b.time} - {b.name} 様</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-sub)', marginLeft: '8px' }}>({b.kana})</span>
                      <div style={{ fontSize: '12px', marginTop: '4px', color: '#666' }}>
                        📞 {b.phone} | ✉️ {b.email} <br />
                        <span style={{ fontSize: '10px', color: '#999' }}>予約番号: {b.bookingId} (受付: {b.timestamp})</span>
                      </div>
                    </div>
                    <button
                      className="primary-btn outline"
                      style={{ width: '90px', padding: '6px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid #ff3b30', color: '#ff3b30' }}
                      onClick={() => executeAdminCancel(b.bookingId)}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* タブB. 枠設定 & 休日管理 */}
      {activeTab === 'schedule' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>⏰ {selectedStore} スケジュール枠設定</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="primary-btn outline" style={{ width: '80px', padding: '6px 12px', fontSize: '13px' }} onClick={() => revertChanges('schedule')}>
                リセット
              </button>
              <button className="primary-btn" style={{ width: '100px', padding: '6px 12px', fontSize: '13px' }} onClick={saveScheduleSettings}>
                設定保存
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {editSettings.map((set, idx) => (
              <div className="admin-day-block" key={idx}>
                <div className="admin-day-header">
                  <span>{set.day}曜日の設定</span>
                  <label className="admin-checkbox">
                    <input
                      type="checkbox"
                      checked={set.active}
                      onChange={(e) => handleSettingActiveChange(idx, e.target.checked)}
                    />
                    <span>営業する</span>
                  </label>
                </div>

                {set.active && (
                  <div>
                    <div className="admin-time-row">
                      <label>営業時間</label>
                      <input
                        type="text"
                        placeholder="09:00"
                        value={set.start}
                        onChange={(e) => handleSettingTimeChange(idx, 'start', e.target.value)}
                      />
                      <span>～</span>
                      <input
                        type="text"
                        placeholder="21:00"
                        value={set.end}
                        onChange={(e) => handleSettingTimeChange(idx, 'end', e.target.value)}
                      />
                    </div>

                    <div className="admin-time-row">
                      <label>休憩時間</label>
                      <input
                        type="text"
                        placeholder="13:00 (空欄可)"
                        value={set.breakStart}
                        onChange={(e) => handleSettingTimeChange(idx, 'breakStart', e.target.value)}
                      />
                      <span>～</span>
                      <input
                        type="text"
                        placeholder="14:00 (空欄可)"
                        value={set.breakEnd}
                        onChange={(e) => handleSettingTimeChange(idx, 'breakEnd', e.target.value)}
                      />
                    </div>

                    <div className="admin-time-row">
                      <label>同時受入枠数</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={set.maxSlots}
                        onChange={(e) => handleSettingMaxSlotsChange(idx, parseInt(e.target.value, 10) || 1)}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--text-sub)' }}>名まで同時に体験予約可</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 休日管理セクション */}
          <div className="summary-card mt-4" style={{ background: '#fff' }}>
            <h3 style={{ fontSize: '15px', color: 'var(--primary-color)', borderBottom: '2px solid var(--primary-color)', paddingBottom: '6px', marginBottom: '16px' }}>
              🏖️ {selectedStore} カスタム休館日設定
            </h3>

            <div className="form-group" style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '20px' }}>
              <div style={{ flex: 1 }}>
                <label>休館日の追加 (YYYY/MM/DD形式)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="例: 2026/05/20"
                  value={newHolidayInput}
                  onChange={(e) => setNewHolidayInput(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="primary-btn"
                style={{ width: '100px', height: '48px', padding: 0 }}
                onClick={addCustomHoliday}
              >
                追加
              </button>
            </div>

            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '13px', marginBottom: '8px' }}>登録済みの休館日</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {editHolidays.map((hDate, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#fff2f2',
                    border: '1px solid #ffcccc',
                    color: '#ff3b30',
                    borderRadius: '20px',
                    padding: '4px 12px',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 'bold'
                  }}
                >
                  <span>{hDate}</span>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: '#ff3b30', cursor: 'pointer', fontWeight: 'bold', padding: '0 2px' }}
                    onClick={() => removeCustomHoliday(hDate)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {editHolidays.length === 0 && (
                <p style={{ color: 'var(--text-sub)', fontSize: '13px', padding: '10px 0' }}>設定されている休館日日はありません。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* タブC. 店舗基本情報・メールテキスト設定 */}
      {activeTab === 'stores' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>🏢 店舗情報詳細マスタ設定</h3>
              <button
                className="primary-btn outline"
                style={{ width: '100px', padding: '4px 8px', fontSize: '12px', borderRadius: '6px' }}
                onClick={addNewStore}
              >
                ＋ 店舗を追加
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="primary-btn outline" style={{ width: '80px', padding: '6px 12px', fontSize: '13px' }} onClick={() => revertChanges('stores')}>
                リセット
              </button>
              <button className="primary-btn" style={{ width: '100px', padding: '6px 12px', fontSize: '13px' }} onClick={saveStoreBasicInfos}>
                一括保存
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {editStores.map((s, sIdx) => (
              <div
                key={sIdx}
                className="summary-card"
                style={{ background: '#fff', border: '1px solid var(--border-color)', position: 'relative' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--primary-color)', paddingBottom: '8px', marginBottom: '16px' }}>
                  <h4 style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--primary-color)' }}>
                    {s.店舗名} の詳細設定
                  </h4>
                  <button
                    className="primary-btn outline"
                    style={{ width: '80px', padding: '4px 8px', fontSize: '12px', borderRadius: '6px', color: '#ff3b30', borderColor: '#ff3b30' }}
                    onClick={() => deleteStore(s.店舗名)}
                  >
                    この店舗を削除
                  </button>
                </div>

                <div className="form-group">
                  <label>店舗住所</label>
                  <input
                    type="text"
                    className="form-control"
                    value={s.住所 || ''}
                    onChange={(e) => handleStoreDetailChange(sIdx, '住所', e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>店舗電話番号</label>
                  <input
                    type="text"
                    className="form-control"
                    value={s.電話番号 || ''}
                    onChange={(e) => handleStoreDetailChange(sIdx, '電話番号', e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>GoogleカレンダーID</label>
                  <input
                    type="text"
                    className="form-control"
                    value={s.カレンダーID || ''}
                    onChange={(e) => handleStoreDetailChange(sIdx, 'カレンダーID', e.target.value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-sub)' }}>
                    カレンダーを分けたい場合はGoogleカレンダーIDを入力。空欄の場合はシステムのデフォルトカレンダーが使用されます。
                  </span>
                </div>

                <div className="form-group">
                  <label>Google Chat 通知WebhookURL</label>
                  <input
                    type="text"
                    className="form-control"
                    value={s.WebhookURL || ''}
                    onChange={(e) => handleStoreDetailChange(sIdx, 'WebhookURL', e.target.value)}
                  />
                  <span style={{ fontSize: '11px', color: 'var(--text-sub)' }}>
                    体験予約が入った際に通知するGoogle Chat Webhookのアドレスを入力します。
                  </span>
                </div>

                <div className="form-group">
                  <label>提供体験プラン名</label>
                  <input
                    type="text"
                    className="form-control"
                    value={s.プラン名 || ''}
                    onChange={(e) => handleStoreDetailChange(sIdx, 'プラン名', e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label>通常価格</label>
                    <input
                      type="text"
                      className="form-control"
                      value={s.通常価格 || ''}
                      onChange={(e) => handleStoreDetailChange(sIdx, '通常価格', e.target.value)}
                    />
                  </div>
                  <div>
                    <label>キャンペーン価格</label>
                    <input
                      type="text"
                      className="form-control"
                      value={s.キャンペーン価格 || ''}
                      onChange={(e) => handleStoreDetailChange(sIdx, 'キャンペーン価格', e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>価格キャンペーン備考欄</label>
                  <input
                    type="text"
                    className="form-control"
                    value={s.キャンペーン備考 || ''}
                    onChange={(e) => handleStoreDetailChange(sIdx, 'キャンペーン備考', e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>自動返信メール持ち物案内文</label>
                  <textarea
                    rows={4}
                    className="form-control"
                    style={{ height: 'auto', fontFamily: 'monospace', fontSize: '14px' }}
                    value={s.メール持ち物 || ''}
                    onChange={(e) => handleStoreDetailChange(sIdx, 'メール持ち物', e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>自動返信メールご来店時注意事項案内文</label>
                  <textarea
                    rows={4}
                    className="form-control"
                    style={{ height: 'auto', fontFamily: 'monospace', fontSize: '14px' }}
                    value={s.メール来店案内 || ''}
                    onChange={(e) => handleStoreDetailChange(sIdx, 'メール来店案内', e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>店舗別利用規約条項</label>
                  <textarea
                    rows={6}
                    className="form-control"
                    style={{ height: 'auto', fontFamily: 'monospace', fontSize: '13px' }}
                    value={s.利用規約 || ''}
                    onChange={(e) => handleStoreDetailChange(sIdx, '利用規約', e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* タブD. システム全体環境設定 */}
      {activeTab === 'system' && editGlobalConfig && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold' }}>💻 システム全体共通設定</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="primary-btn outline" style={{ width: '80px', padding: '6px 12px', fontSize: '13px' }} onClick={() => revertChanges('system')}>
                リセット
              </button>
              <button className="primary-btn" style={{ width: '100px', padding: '6px 12px', fontSize: '13px' }} onClick={saveSystemConfig}>
                設定保存
              </button>
            </div>
          </div>

          <div className="summary-card" style={{ background: '#fff' }}>
            <div className="form-group">
              <label htmlFor="admin-pin-set">管理者暗証番号 (PIN)</label>
              <input
                type="text"
                id="admin-pin-set"
                className="form-control"
                style={{ width: '200px', fontWeight: 'bold', fontSize: '18px', color: 'var(--primary-color)' }}
                value={editGlobalConfig.ADMIN_PIN || ''}
                onChange={(e) => handleSystemConfigChange('ADMIN_PIN', e.target.value)}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-sub)' }}>
                管理者画面へログインする際の数字・英字PINコードを指定します。
              </span>
            </div>

            <div className="form-group">
              <label>共通デフォルトGoogleカレンダーID</label>
              <input
                type="text"
                className="form-control"
                value={editGlobalConfig.DEFAULT_CALENDAR_ID || ''}
                onChange={(e) => handleSystemConfigChange('DEFAULT_CALENDAR_ID', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>共通デフォルトGoogle Chat WebhookURL</label>
              <input
                type="text"
                className="form-control"
                value={editGlobalConfig.DEFAULT_WEBHOOK_URL || ''}
                onChange={(e) => handleSystemConfigChange('DEFAULT_WEBHOOK_URL', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>共通デフォルト体験プラン名</label>
              <input
                type="text"
                className="form-control"
                value={editGlobalConfig.DEFAULT_PLAN_NAME || ''}
                onChange={(e) => handleSystemConfigChange('DEFAULT_PLAN_NAME', e.target.value)}
              />
            </div>

            <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label>共通デフォルト通常料金</label>
                <input
                  type="text"
                  className="form-control"
                  value={editGlobalConfig.DEFAULT_NORMAL_PRICE || ''}
                  onChange={(e) => handleSystemConfigChange('DEFAULT_NORMAL_PRICE', e.target.value)}
                />
              </div>
              <div>
                <label>共通デフォルトキャンペーン料金</label>
                <input
                  type="text"
                  className="form-control"
                  value={editGlobalConfig.DEFAULT_CAMPAIGN_PRICE || ''}
                  onChange={(e) => handleSystemConfigChange('DEFAULT_CAMPAIGN_PRICE', e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label>共通デフォルト価格キャンペーン備考</label>
              <input
                type="text"
                className="form-control"
                value={editGlobalConfig.DEFAULT_CAMPAIGN_MEMO || ''}
                onChange={(e) => handleSystemConfigChange('DEFAULT_CAMPAIGN_MEMO', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>共通デフォルト自動返信メール持ち物案内文</label>
              <textarea
                rows={4}
                className="form-control"
                style={{ height: 'auto', fontFamily: 'monospace' }}
                value={editGlobalConfig.DEFAULT_EMAIL_ITEMS || ''}
                onChange={(e) => handleSystemConfigChange('DEFAULT_EMAIL_ITEMS', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>共通デフォルト自動返信メール来店時注意事項案内文</label>
              <textarea
                rows={4}
                className="form-control"
                style={{ height: 'auto', fontFamily: 'monospace' }}
                value={editGlobalConfig.DEFAULT_EMAIL_VISIT || ''}
                onChange={(e) => handleSystemConfigChange('DEFAULT_EMAIL_VISIT', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>共通デフォルト利用規約条項</label>
              <textarea
                rows={6}
                className="form-control"
                style={{ height: 'auto', fontFamily: 'monospace', fontSize: '13px' }}
                value={editGlobalConfig.DEFAULT_TERMS || ''}
                onChange={(e) => handleSystemConfigChange('DEFAULT_TERMS', e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ローディングオーバーレイ */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>処理を実行中...</p>
        </div>
      )}
      
      <div className="text-center" style={{ margin: '40px 0 20px 0' }}>
        <Link href="/" className="back-btn" style={{ margin: 0 }}>
          ← 体験予約フロント画面へ戻る
        </Link>
      </div>
    </section>
  );
}
