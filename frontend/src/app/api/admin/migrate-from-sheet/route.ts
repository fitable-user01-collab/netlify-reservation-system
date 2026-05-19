import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { authPin, stores, settings, holidays, systemConfig, bookings } = body;

    // 1. PINコードによる簡易セキュリティ認証
    const expectedPin = process.env.ADMIN_PIN || '1234';
    if (authPin !== expectedPin) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid authPin' }, { status: 401 });
    }

    const batch = db.batch();

    // 2. 店舗基本情報の登録 (stores コレクション)
    if (Array.isArray(stores)) {
      stores.forEach((s: any) => {
        if (!s.店舗名) return;
        const storeRef = db.collection('stores').doc(s.店舗名);
        batch.set(storeRef, {
          住所: s.住所 || '',
          電話番号: s.電話番号 || '',
          カレンダーID: s.カレンダーID || '',
          WebhookURL: s.WebhookURL || '',
          メール持ち物: s.メール持ち物 || '',
          メール来店案内: s.メール来店案内 || '',
          利用規約: s.利用規約 || '',
          プラン名: s.プラン名 || '',
          通常価格: s.通常価格 || '',
          キャンペーン価格: s.キャンペーン価格 || '',
          キャンペーン備考: s.キャンペーン備考 || ''
        }, { merge: true });
      });
    }

    // 3. 曜日別・店舗別スケジュール設定の登録 (stores/{storeName}/settings/{dayName})
    if (Array.isArray(settings)) {
      settings.forEach((set: any) => {
        if (!set.店舗 || !set.曜日) return;
        const slotRef = db.collection('stores').doc(set.店舗).collection('settings').doc(set.曜日);
        batch.set(slotRef, {
          active: set.営業フラグ === true || set.営業フラグ === 'true' || set.営業フラグ === 'TRUE' || set.営業フラグ === 1,
          start: set.開始時間 || '09:00',
          end: set.終了時間 || '21:00',
          breakStart: set.休憩開始 || '',
          breakEnd: set.休憩終了 || '',
          maxSlots: parseInt(set.最大枠数, 10) || 1
        }, { merge: true });
      });
    }

    // 4. 休館日情報の登録 (holidays コレクション)
    if (Array.isArray(holidays)) {
      // 既存の休日を一度全件削除してクリーンにする
      const holidaySnapshot = await db.collection('holidays').get();
      holidaySnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      holidays.forEach((h: any) => {
        if (!h.店舗 || !h.年月日) return;
        const holidayRef = db.collection('holidays').doc();
        batch.set(holidayRef, {
          store: h.店舗,
          date: h.年月日 // YYYY/MM/DD形式
        });
      });
    }

    // 5. システム設定の登録 (system_config コレクション)
    if (Array.isArray(systemConfig)) {
      const globalConfigRef = db.collection('system_config').doc('global');
      const configObj: Record<string, any> = {};
      systemConfig.forEach((c: any) => {
        if (!c.設定名) return;
        configObj[c.設定名] = c.設定値;
      });
      batch.set(globalConfigRef, configObj, { merge: true });
    }

    // 6. 予約履歴データの登録 (bookings コレクション)
    if (Array.isArray(bookings)) {
      bookings.forEach((b: any) => {
        if (!b.予約番号) return;
        const bookingRef = db.collection('bookings').doc(b.予約番号);
        batch.set(bookingRef, {
          timestamp: b.予約日時 || '',
          status: b.ステータス || '予約確定',
          name: b.氏名 || '',
          kana: b.フリガナ || '',
          phone: b.電話番号 || '',
          email: b.メールアドレス || '',
          store: b.店舗 || '',
          date: b.体験日 || '',
          time: b.時間帯 || '',
          eventId: b.イベントID || ''
        }, { merge: true });
      });
    }

    // バッチ処理の実行
    await batch.commit();

    return NextResponse.json({ success: true, message: 'スプレッドシートのデータをFirestoreへ正常に移行しました。' });
  } catch (error: any) {
    console.error('Migration API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
