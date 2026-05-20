import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const yearMonth = searchParams.get('yearMonth'); // YYYY-MM
    const authPin = searchParams.get('authPin');

    if (!yearMonth || !authPin) {
      return NextResponse.json({ success: false, error: 'パラメーターが不足しています。' }, { status: 400 });
    }

    // 1. セキュリティ認証
    const globalDoc = await db.collection('system_config').doc('global').get();
    const adminPin = globalDoc.exists ? globalDoc.data()?.ADMIN_PIN : '1234';

    if (String(authPin) !== String(adminPin)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. 該当月の開始日と終了日を算出
    const [year, month] = yearMonth.split('-').map(Number);
    const startDateStr = `${year}/${String(month).padStart(2, '0')}/01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDateStr = `${year}/${String(month).padStart(2, '0')}/${String(lastDay).padStart(2, '0')}`;

    // 3. Firestoreより全店舗の全予約データを取得
    const bookingsSnapshot = await db.collection('bookings').get();

    const reservations: any[] = [];
    bookingsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.date && data.date >= startDateStr && data.date <= endDateStr) {
        reservations.push({
          bookingId: doc.id,
          timestamp: data.timestamp || '',
          status: data.status || '予約確定',
          name: data.name || '',
          kana: data.kana || '',
          phone: data.phone || '',
          email: data.email || '',
          date: data.date || '',
          time: data.time || '',
          store: data.store || '',
          notes: data.notes || ''
        });
      }
    });

    // 日付順・時間順にソート
    reservations.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.time !== b.time) return a.time.localeCompare(b.time);
      return (a.store || '').localeCompare(b.store || '');
    });

    return NextResponse.json({ success: true, reservations });
  } catch (error: any) {
    console.error('Export CSV API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
