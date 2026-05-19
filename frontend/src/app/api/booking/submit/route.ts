import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
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
  const gmailPass = process.env.GMAIL_PASS; // Googleアカウントで生成したアプリパスワード

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

    const address = storeInfo?.住所 || '（住所未登録）';
    const phone = storeInfo?.電話番号 || '（電話番号未登録）';
    const mailItems = storeInfo?.メール持ち物 || config?.DEFAULT_EMAIL_ITEMS || '';
    const mailVisit = storeInfo?.メール来店案内 || config?.DEFAULT_EMAIL_VISIT || '';
    const planName = storeInfo?.プラン名 || config?.DEFAULT_PLAN_NAME || '体験トレーニング';
    const normalPrice = storeInfo?.通常価格 || config?.DEFAULT_NORMAL_PRICE || '';
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
               `·お名前: ${data.name} 様 (${data.kana || ''})\n` +
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
    const storeDoc = await db.collection('stores').doc(store).get();
    const storeInfo = storeDoc.exists ? storeDoc.data() : null;

    const globalDoc = await db.collection('system_config').doc('global').get();
    const globalConfig = globalDoc.exists ? globalDoc.data() : null;

    const calendarId = storeInfo?.カレンダーID || globalConfig?.DEFAULT_CALENDAR_ID || 'primary';

    // 2. 予約番号の決定と、Firestore Transactionによるダブルブッキング排他ロック制御
    const bookingId = generateShortBookingId();
    const timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    // 同一店舗の該当枠の空き状況をトランザクション内で再検証して安全を確保する
    const isSlotAvailable = await db.runTransaction(async (transaction) => {
      // 日ごとの祝日や設定を再チェックするのはフロント側で行い、ここでは単純に予約数の制限チェックを行う
      // 曜日名を取得
      const dateObj = new Date(date.replace(/\//g, '/'));
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      let dayName = dayNames[dateObj.getDay()];

      // 簡易祝日/休日判定 (実用上はFirestoreとカレンダー等から曜日設定を参照)
      // 店舗設定ドキュメントを取得
      const settingsRef = db.collection('stores').doc(store).collection('settings').doc(dayName);
      const settingsDoc = await transaction.get(settingsRef);
      const settings = settingsDoc.exists ? settingsDoc.data() : { active: true, maxSlots: 1 };

      const maxSlots = settings?.maxSlots || 1;

      // 現在の予約済み件数を取得
      const bookingsQuery = db
        .collection('bookings')
        .where('store', '==', store)
        .where('date', '==', date)
        .where('time', '==', time)
        .where('status', '==', '予約確定');
      
      const bookingsSnapshot = await transaction.get(bookingsQuery);
      const currentBookedCount = bookingsSnapshot.size;

      if (currentBookedCount >= maxSlots) {
        return false; // すでに満席
      }

      // 予約ドキュメントを書き込み登録
      const bookingRef = db.collection('bookings').doc(bookingId);
      transaction.set(bookingRef, {
        timestamp,
        status: '予約確定',
        name: data.name,
        kana: data.kana || '',
        phone: data.phone,
        email: data.email,
        notes: data.notes || '',
        store,
        date,
        time,
        eventId: '' // 後ほど登録されたIDを入れる
      });

      return true;
    });

    if (!isSlotAvailable) {
      return NextResponse.json({ success: false, error: '大変申し訳ございません。直前に他のお客様の予約が入ったため、選択された枠が満席になりました。他の時間帯を選択してください。' }, { status: 409 });
    }

    // 3. カレンダーイベントの作成
    const eventId = await createCalendarEvent(data, calendarId);
    if (eventId) {
      // 予約ドキュメントにeventIdを反映
      await db.collection('bookings').doc(bookingId).update({ eventId });
    }

    // 4. 自動返信確認メールの送信
    const emailSuccess = await sendConfirmationEmail(data, bookingId, storeInfo, globalConfig);

    // 5. Google ChatへのWebhook通知
    const webhookUrl = storeInfo?.WebhookURL || globalConfig?.DEFAULT_WEBHOOK_URL || '';
    await sendChatNotification(data, bookingId, webhookUrl, !emailSuccess);

    return NextResponse.json({ success: true, bookingId });
  } catch (error: any) {
    console.error('Submit Booking API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
