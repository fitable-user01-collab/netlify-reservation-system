import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

const formatPrivateKey = (key: string | undefined): string | undefined => {
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n');
};

// Googleカレンダーのイベントを削除する
async function deleteCalendarEvent(eventId: string, calendarId: string): Promise<boolean> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

  if (!email || !privateKey) {
    console.warn('Google Credentials not set, skipping calendar event deletion');
    return false;
  }

  try {
    const auth = new google.auth.JWT(
      email,
      undefined,
      privateKey,
      ['https://www.googleapis.com/auth/calendar']
    );

    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.delete({
      calendarId,
      eventId,
    });

    return true;
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const { bookingId, email, authPin } = await req.json();

    if (!bookingId) {
      return NextResponse.json({ success: false, error: '予約番号を指定してください。' }, { status: 400 });
    }

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

    if (!bookingDoc.exists) {
      return NextResponse.json({ success: false, error: '該当する予約情報が見つかりません。' }, { status: 404 });
    }

    const booking = bookingDoc.data();

    // 管理者PINが渡され、一致した場合はメール検証をスキップする
    let isBypassed = false;
    if (authPin) {
      const globalDoc = await db.collection('system_config').doc('global').get();
      const adminPin = globalDoc.exists ? globalDoc.data()?.ADMIN_PIN : '1234';
      if (String(authPin) === String(adminPin)) {
        isBypassed = true;
      }
    }

    if (!isBypassed) {
      if (!email) {
        return NextResponse.json({ success: false, error: 'メールアドレスを入力してください。' }, { status: 400 });
      }
      if (booking?.email?.toLowerCase().trim() !== email.toLowerCase().trim()) {
        return NextResponse.json({ success: false, error: '予約番号またはメールアドレスが一致しません。' }, { status: 403 });
      }
    }

    if (booking?.status === 'キャンセル') {
      return NextResponse.json({ success: false, error: 'この予約はすでにキャンセルされています。' }, { status: 400 });
    }

    // 1. Firestore上のステータスをキャンセルに更新
    await bookingRef.update({ status: 'キャンセル' });

    // 2. Googleカレンダーイベントの削除
    if (booking?.eventId && booking?.store) {
      const storeDoc = await db.collection('stores').doc(booking.store).get();
      const storeInfo = storeDoc.exists ? storeDoc.data() : null;

      const globalDoc = await db.collection('system_config').doc('global').get();
      const globalConfig = globalDoc.exists ? globalDoc.data() : null;

      const calendarId = storeInfo?.カレンダーID || globalConfig?.DEFAULT_CALENDAR_ID || 'primary';

      await deleteCalendarEvent(booking.eventId, calendarId);
    }

    return NextResponse.json({ success: true, name: booking?.name });
  } catch (error: any) {
    console.error('Cancel Booking API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
