import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function POST(req: Request) {
  try {
    const { authPin, store, settings, holidays } = await req.json();

    if (!store) {
      return NextResponse.json({ success: false, error: '店舗名が指定されていません。' }, { status: 400 });
    }

    // 1. セキュリティ認証
    const globalDoc = await db.collection('system_config').doc('global').get();
    const adminPin = globalDoc.exists ? globalDoc.data()?.ADMIN_PIN : '1234';

    if (String(authPin) !== String(adminPin)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const batch = db.batch();

    // 2. 曜日設定の保存 (stores/{store}/settings/{day})
    if (Array.isArray(settings)) {
      settings.forEach((set: any) => {
        if (!set.day) return;
        const ref = db.collection('stores').doc(store).collection('settings').doc(set.day);
        batch.set(ref, {
          active: set.active === true || set.active === 'true',
          start: set.start || '09:00',
          end: set.end || '21:00',
          breakStart: set.breakStart || '',
          breakEnd: set.breakEnd || '',
          maxSlots: parseInt(set.maxSlots, 10) || 1
        }, { merge: true });
      });
    }

    // 3. 休日設定の保存 (holidays コレクション)
    if (Array.isArray(holidays)) {
      // 既存の当該店舗の休日を一度全削除
      const holidaySnapshot = await db
        .collection('holidays')
        .where('store', '==', store)
        .get();
      
      holidaySnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      // 新しい休日を登録
      holidays.forEach((dateStr: string) => {
        if (!dateStr) return;
        const ref = db.collection('holidays').doc();
        batch.set(ref, {
          store,
          date: dateStr // YYYY/MM/DD形式
        });
      });
    }

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Save Settings API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const store = searchParams.get('store');
    const authPin = searchParams.get('authPin');

    if (!store || !authPin) {
      return NextResponse.json({ success: false, error: 'パラメーターが不足しています。' }, { status: 400 });
    }

    // 1. セキュリティ認証
    const globalDoc = await db.collection('system_config').doc('global').get();
    const adminPin = globalDoc.exists ? globalDoc.data()?.ADMIN_PIN : '1234';

    if (String(authPin) !== String(adminPin)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. 曜日設定の取得
    const settingsSnapshot = await db.collection('stores').doc(store).collection('settings').get();
    const settings: any[] = [];
    settingsSnapshot.forEach(doc => {
      settings.push({
        day: doc.id,
        ...doc.data()
      });
    });

    // デフォルト曜日定義
    const defaultDays = ['月', '火', '水', '木', '金', '土', '日', '祝'];
    const finalSettings = defaultDays.map(day => {
      const found = settings.find(s => s.day === day);
      if (found) {
        return found;
      }
      return {
        day,
        active: true,
        start: '09:00',
        end: '21:00',
        breakStart: '13:00',
        breakEnd: '14:00',
        maxSlots: 1
      };
    });

    // 3. 休日設定の取得
    const holidaysSnapshot = await db
      .collection('holidays')
      .where('store', '==', store)
      .get();
    
    const holidays: string[] = [];
    holidaysSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.date) {
        holidays.push(data.date);
      }
    });

    holidays.sort();

    return NextResponse.json({ settings: finalSettings, holidays });
  } catch (error: any) {
    console.error('Get Settings API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

