import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const store = searchParams.get('store');
    const yearMonth = searchParams.get('yearMonth'); // 期待形式: YYYY-MM
    const authPin = searchParams.get('authPin');

    if (!store || !yearMonth || !authPin) {
      return NextResponse.json({ success: false, error: 'パラメーターが不足しています。' }, { status: 400 });
    }

    // 1. セキュリティ認証
    const globalDoc = await db.collection('system_config').doc('global').get();
    const adminPin = globalDoc.exists ? globalDoc.data()?.ADMIN_PIN : '1234';

    if (String(authPin) !== String(adminPin)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. 該当月の開始日と終了日を算出
    // 例: yearMonth = "2026-05" -> startDateStr = "2026/05/01", endDateStr = "2026/05/31"
    const [year, month] = yearMonth.split('-').map(Number);
    const startDateStr = `${year}/${String(month).padStart(2, '0')}/01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDateStr = `${year}/${String(month).padStart(2, '0')}/${String(lastDay).padStart(2, '0')}`;

    // 3. Firestoreより予約状況を取得 (インデックスエラー防止のためメモリ内で日付・ステータスフィルタ)
    const bookingsSnapshot = await db
      .collection('bookings')
      .where('store', '==', store)
      .get();

    const reservations: any[] = [];
    bookingsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.status === '予約確定' && data.date && data.date >= startDateStr && data.date <= endDateStr) {
        reservations.push({
          bookingId: doc.id,
          timestamp: data.timestamp || '',
          name: data.name || '',
          kana: data.kana || '',
          phone: data.phone || '',
          email: data.email || '',
          date: data.date || '',
          time: data.time || ''
        });
      }
    });

    // 日付順・時間順にソートして返す
    reservations.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.time.localeCompare(b.time);
    });

    return NextResponse.json(reservations);
  } catch (error: any) {
    console.error('Get Reservations API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
