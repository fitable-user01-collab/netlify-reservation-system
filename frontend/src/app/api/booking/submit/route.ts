import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';

const formatPrivateKey = (key: string | undefined): string | undefined => {
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n');
};

// 6桁の短縮予約番号を生成する
function generateShortBookingId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I, O, 0, 1 を除いた見間違い防止文字
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Googleカレンダーにイベントを作成する
async function createCalendarEvent(data: any, calendarId: string): Promise<string | null> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

  if (!email || !privateKey) {
    console.warn('Google Credentials not set, skipping calendar event creation');
    return null;
  }

  try {
    const auth = new google.auth.JWT(
      email,
      undefined,
      privateKey,
      ['https://www.googleapis.com/auth/calendar']
    );

    const calendar = google.calendar({ version: 'v3', auth });

    const title = `【体験予約】${data.name}様 (${data.store})`;
    const timeParts = data.time.split('～');
    const [startHour, startMin] = timeParts[0].split(':');
    const [endHour, endMin] = timeParts[1].split(':');

    const dateStr = data.date.replace(/\//g, '-');
    const startTimeStr = `${dateStr}T${startHour}:${startMin}:00+09:00`;
    const endTimeStr = `${dateStr}T${endHour}:${endMin}:00+09:00`;

    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: title,
        description: `電話番号: ${data.phone}\nメールアドレス: ${data.email}\n店舗: ${data.store}\n備考: ${data.notes || 'なし'}`,
        start: { dateTime: startTimeStr, timeZone: 'Asia/Tokyo' },
        end: { dateTime: endTimeStr, timeZone: 'Asia/Tokyo' },
      },
    });

    return response.data.id || null;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    return null;
  }
}

// Gmail経由で確認メールを送信する
async function sendConfirmationEmail(data: any, bookingId: string, storeInfo: any, config: any): Promise<boolean> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_PASS;

  if (!gmailUser || !gmailPass) {
    console.warn('Gmail credentials not configured in environment variables');
    return false;
  }

  if (!data.email || data.email === 'admin@example.com' || data.email.includes('example.com')) {
    console.log('Skipping email for admin or invalid address');
    return true;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
    });

    const subject = '【ジム体験予約】ご予約を受け付けました';
    const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/cancel`;

    const address = storeInfo?.address || '（住所未登録）';
    const phone = storeInfo?.phone || '（電話番号未登録）';
    const mailItems = storeInfo?.email_items || config?.DEFAULT_EMAIL_ITEMS || '';
    const mailVisit = storeInfo?.email_visit || config?.DEFAULT_EMAIL_VISIT || '';
    const planName = storeInfo?.plan_name || config?.DEFAULT_PLAN_NAME || '体験トレーニング';
    const normalPrice = storeInfo?.normal_price || config?.DEFAULT_NORMAL_PRICE || '';
    const priceText = normalPrice;

    let body = `${data.name} 様\n\n` +
      `この度はFITABLEの無料体験にご予約いただき、誠にありがとうございます。\n` +
      `以下の内容でご予約を承りました。\n\n` +
      `■ご予約内容\n` +
      `【予約番号】 ${bookingId}\n` +
      `【店舗】 ${data.store}\n` +
      `【ご来店日時】 ${data.date} ${data.time}\n` +
      `【プラン】 ${planName}\n` +
      `【料金】 ${priceText}\n` +
      (data.notes ? `【備考】\n${data.notes}\n\n` : `\n`) +
      `■店舗情報\n` +
      `【住所】 ${address}\n` +
      `【電話番号】 ${phone}\n`;

    if (mailItems) {
      body += `\n■当日の持ち物案内\n${mailItems}\n`;
    }
    if (mailVisit) {
      body += `\n■ご来店について\n${mailVisit}\n`;
    }

    body += `\n` +
      `※万が一、ご都合が悪くなった場合は、以下のURLよりキャンセル手続きをお願いいたします。\n` +
      `キャンセルURL: ${cancelUrl}\n` +
      `予約番号とメールアドレスが必要になります。\n\n` +
      `当日お会いできることをスタッフ一同楽しみにしております。\n`;

    await transporter.sendMail({
      from: `"FITABLE 体験予約窓口" <${gmailUser}>`,
      to: data.email,
      subject,
      text: body,
    });

    return true;
  } catch (error) {
    console.error('Nodemailer Gmail Send Error:', error);
    return false;
  }
}

// Google Chat通知
async function sendChatNotification(data: any, bookingId: string, webhookUrl: string, emailFailed: boolean) {
  if (!webhookUrl || webhookUrl.startsWith('YOUR_GOOGLE_CHAT')) return;

  const emailWarning = emailFailed ? ' ⚠️ *【メールの送信に失敗しました。メールアドレスが不正の可能性があります】*' : '';

  const text = `*新規体験予約が入りました!*\n` +
               `・店舗: ${data.store}\n` +
               `・日時: ${data.date} ${data.time}\n` +
               `・お名前: ${data.name} 様 (${data.kana || ''})\n` +
               `・電話番号: ${data.phone || ''}\n` +
               `・メール: ${data.email || ''}${emailWarning}\n` +
               `・備考: ${data.notes || 'なし'}\n` +
               `・予約番号: ${bookingId}`;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    console.error('Google Chat Notification Webhook Error:', error);
  }
}

export async function POST(req: Request) {
  try {
    const data = await req.json(); // name, kana, phone, email, store, date, time
    const { store, date, time } = data;

    if (!store || !date || !time || !data.name || !data.phone || !data.email) {
      return NextResponse.json({ success: false, error: '入力値が不足しています。' }, { status: 400 });
    }

    // 1. 店舗情報とグローバル設定の取得
    const { data: storeInfo, error: storeError } = await supabase
      .from('stores')
      .select('*')
      .eq('name', store)
      .single();

    if (storeError && storeError.code !== 'PGRST116') {
      throw storeError;
    }

    const { data: configData } = await supabase
      .from('system_config')
      .select('config')
      .eq('key', 'global')
      .single();
    
    const globalConfig = configData?.config || {};

    const calendarId = storeInfo?.calendar_id || globalConfig?.DEFAULT_CALENDAR_ID || 'primary';

    // 2. 予約番号の決定と、ストアドファンクション（RPC）によるダブルブッキング排他ロック制御
    const bookingId = generateShortBookingId();
    const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    // 同一店舗の該当枠の空き状況をトランザクション内で検証して安全に挿入する
    const { data: isSlotAvailable, error: rpcError } = await supabase.rpc('submit_booking_v1', {
      p_booking_id: bookingId,
      p_name: data.name,
      p_kana: data.kana || '',
      p_phone: data.phone,
      p_email: data.email,
      p_notes: data.notes || '',
      p_store_name: store,
      p_date: date,
      p_time: time,
      p_timestamp: timestamp
    });

    if (rpcError) {
      throw rpcError;
    }

    if (!isSlotAvailable) {
      return NextResponse.json({ 
        success: false, 
        error: '大変申し訳ございません。直前に他のお客様の予約が入ったため、選択された枠が満席になりました。他の時間帯を選択してください。' 
      }, { status: 409 });
    }

    // 3. カレンダーイベントの作成
    const eventId = await createCalendarEvent(data, calendarId);
    if (eventId) {
      // 予約レコードに event_id を反映
      await supabase
        .from('bookings')
        .update({ event_id: eventId })
        .eq('id', bookingId);
    }

    // 4. 自動返信確認メールの送信
    const emailSuccess = await sendConfirmationEmail(data, bookingId, storeInfo, globalConfig);

    // 5. Google ChatへのWebhook通知
    const webhookUrl = storeInfo?.webhook_url || globalConfig?.DEFAULT_WEBHOOK_URL || '';
    await sendChatNotification(data, bookingId, webhookUrl, !emailSuccess);

    return NextResponse.json({ success: true, bookingId });
  } catch (error: any) {
    console.error('Submit Booking API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
