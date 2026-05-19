import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function POST(req: Request) {
  try {
    const { authPin, stores } = await req.json();

    if (!Array.isArray(stores)) {
      return NextResponse.json({ success: false, error: '店舗リストの形式が正しくありません。' }, { status: 400 });
    }

    // 1. セキュリティ認証
    const globalDoc = await db.collection('system_config').doc('global').get();
    const adminPin = globalDoc.exists ? globalDoc.data()?.ADMIN_PIN : '1234';

    if (String(authPin) !== String(adminPin)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const batch = db.batch();

    // 2. 既存の全店舗リストを取得（削除対象を検出するため）
    const existingStoresSnapshot = await db.collection('stores').get();
    const existingStoreNames = existingStoresSnapshot.docs.map(doc => doc.id);
    const newStoreNames = new Set(stores.map((s: any) => s.店舗名).filter(Boolean));

    // 送信データにない既存店舗を削除する
    existingStoreNames.forEach(storeName => {
      if (!newStoreNames.has(storeName)) {
        const ref = db.collection('stores').doc(storeName);
        batch.delete(ref);
      }
    });

    // 3. 各店舗情報を登録・更新する
    stores.forEach((s: any) => {
      if (!s.店舗名) return;
      const ref = db.collection('stores').doc(s.店舗名);
      batch.set(ref, {
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

    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Save Stores API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
