import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
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

    // 1. Supabaseから予約情報の取得
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      return NextResponse.json({ success: false, error: '該当する予約情報が見つかりません。' }, { status: 404 });
    }

    // 管理者PINが渡され、一致した場合はメール検証をスキップする
    let isBypassed = false;
    if (authPin) {
      const { data: configData } = await supabase
        .from('system_config')
        .select('config')
        .eq('key', 'global')
        .single();
      const adminPin = configData?.config?.ADMIN_PIN || '1234';
      if (String(authPin) === String(adminPin)) {
        isBypassed = true;
      }
    }

    if (!isBypassed) {
      if (!email) {
        return NextResponse.json({ success: false, error: 'メールアドレスを入力してください。' }, { status: 400 });
      }
      if (booking.email?.toLowerCase().trim() !== email.toLowerCase().trim()) {
        return NextResponse.json({ success: false, error: '予約番号またはメールアドレスが一致しません。' }, { status: 403 });
      }
    }

    if (booking.status === 'キャンセル') {
      return NextResponse.json({ success: false, error: 'この予約はすでにキャンセルされています。' }, { status: 400 });
    }

    // 2. Supabase上のステータスをキャンセルに更新
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'キャンセル' })
      .eq('id', bookingId);

    if (updateError) throw updateError;

    // 3. Googleカレンダーイベントの削除
    if (booking.event_id && booking.store_name) {
      const { data: storeInfo } = await supabase
        .from('stores')
        .select('calendar_id')
        .eq('name', booking.store_name)
        .single();

      const { data: configData } = await supabase
        .from('system_config')
        .select('config')
        .eq('key', 'global')
        .single();

      const calendarId = storeInfo?.calendar_id || configData?.config?.DEFAULT_CALENDAR_ID || 'primary';

      await deleteCalendarEvent(booking.event_id, calendarId);
    }

    return NextResponse.json({ success: true, name: booking.name });
  } catch (error: any) {
    console.error('Cancel Booking API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
