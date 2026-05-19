import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

const formatPrivateKey = (key: string | undefined): string | undefined => {
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n');
};

// Google Calendar APIから祝日を取得するヘルパー関数
async function getJapaneseHolidays(startDateStr: string, endDateStr: string): Promise<Set<string>> {
  const holidays = new Set<string>();
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = formatPrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

  if (!email || !privateKey) {
    console.warn('Google Credentials not set, skipping national holidays query');
    return holidays;
  }

  try {
    const auth = new google.auth.JWT(
      email,
      undefined,
      privateKey,
      ['https://www.googleapis.com/auth/calendar.readonly']
    );

    const calendar = google.calendar({ version: 'v3', auth });
    
    // 開始日時と終了日時を設定 (JST基準)
    const timeMin = new Date(startDateStr.replace(/\//g, '-') + 'T00:00:00+09:00').toISOString();
    const timeMax = new Date(endDateStr.replace(/\//g, '-') + 'T23:59:59+09:00').toISOString();

    const response = await calendar.events.list({
      calendarId: 'ja.japanese#holiday@group.v.calendar.google.com',
      timeMin,
      timeMax,
      singleEvents: true,
    });

    const events = response.data.items || [];
    events.forEach(event => {
      if (event.start && event.start.date) {
        // YYYY-MM-DDをYYYY/MM/DDに整形して登録
        const formattedDate = event.start.date.replace(/-/g, '/');
        holidays.add(formattedDate);
      }
    });
  } catch (error) {
    console.error('Error fetching Japanese national holidays:', error);
  }

  return holidays;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const store = searchParams.get('store');
    const startDateStr = searchParams.get('startDate'); // 期待形式: YYYY/MM/DD

    if (!store || !startDateStr) {
      return NextResponse.json({ success: false, error: 'Missing parameters' }, { status: 400 });
    }

    const startDate = new Date(startDateStr.replace(/-/g, '/'));
    startDate.setHours(0, 0, 0, 0);

    // 1週間（7日間）の終了日を算出
    const endDate = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000);
    const formatDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dateVal = String(d.getDate()).padStart(2, '0');
      return `${y}/${m}/${dateVal}`;
    };
    const endDateStr = formatDate(endDate);

    // 1. Googleカレンダーから祝日情報を取得
    const nationalHolidays = await getJapaneseHolidays(startDateStr, endDateStr);

    // 2. 店舗別・曜日別のスケジュール設定をFirestoreから取得
    const settingsSnapshot = await db.collection('stores').doc(store).collection('settings').get();
    const storeSettingsMap: Record<string, any> = {};
    settingsSnapshot.forEach(doc => {
      storeSettingsMap[doc.id] = doc.data();
    });

    // 3. 店舗個別の休館日情報をFirestoreから取得
    const holidaysSnapshot = await db
      .collection('holidays')
      .where('store', '==', store)
      .where('date', '>=', startDateStr)
      .where('date', '<=', endDateStr)
      .get();
    
    const storeHolidaysSet = new Set<string>();
    holidaysSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.date) {
        storeHolidaysSet.add(data.date);
      }
    });

    // 4. 予約件数の確認
    const bookingsSnapshot = await db
      .collection('bookings')
      .where('store', '==', store)
      .where('status', '==', '予約確定')
      .where('date', '>=', startDateStr)
      .where('date', '<=', endDateStr)
      .get();

    // 予約状況マップを作成: { "2026/05/19": { "09:00～10:00": 1, ... } }
    const bookingCountsMap: Record<string, Record<string, number>> = {};
    bookingsSnapshot.forEach(doc => {
      const b = doc.data();
      if (b.date && b.time) {
        if (!bookingCountsMap[b.date]) {
          bookingCountsMap[b.date] = {};
        }
        bookingCountsMap[b.date][b.time] = (bookingCountsMap[b.date][b.time] || 0) + 1;
      }
    });

    // 5. 1週間の空き枠算出処理
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const weeklySlots: any[] = [];

    const now = new Date();
    // 日本時間に合わせた今日の日付と時間
    const toJstTime = (date: Date) => {
      return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    };
    const jstNow = toJstTime(now);
    const todayStr = formatDate(jstNow);
    const nowHour = jstNow.getHours();

    for (let dOffset = 0; dOffset < 7; dOffset++) {
      const targetDate = new Date(startDate.getTime() + dOffset * 24 * 60 * 60 * 1000);
      const targetDateStr = formatDate(targetDate);
      let dayName = dayNames[targetDate.getDay()];

      // 祝日判定
      if (nationalHolidays.has(targetDateStr)) {
        dayName = '祝';
      }

      const dayResult = {
        date: targetDateStr,
        dayName: dayName,
        slots: [] as any[]
      };

      // 店舗休館日リストに入っている場合は空枠をスキップ
      if (storeHolidaysSet.has(targetDateStr)) {
        weeklySlots.push(dayResult);
        continue;
      }

      // 曜日設定の読み込み
      let storeSettings = storeSettingsMap[dayName];
      if (!storeSettings) {
        // デフォルト設定
        storeSettings = {
          active: true,
          start: '09:00',
          end: '21:00',
          breakStart: '13:00',
          breakEnd: '14:00',
          maxSlots: 1
        };
      }

      if (!storeSettings.active) {
        weeklySlots.push(dayResult);
        continue;
      }

      // 時間スロットの作成 (1時間刻み)
      let currentHour = parseInt(storeSettings.start.split(':')[0], 10);
      const endHour = parseInt(storeSettings.end.split(':')[0], 10);

      let bStartHour = -1;
      let bEndHour = -1;
      if (storeSettings.breakStart) {
        bStartHour = parseInt(storeSettings.breakStart.split(':')[0], 10);
      }
      if (storeSettings.breakEnd) {
        bEndHour = parseInt(storeSettings.breakEnd.split(':')[0], 10);
      }

      const dailyBookings = bookingCountsMap[targetDateStr] || {};

      while (currentHour < endHour) {
        // 休憩時間判定
        if (currentHour >= bStartHour && currentHour < bEndHour) {
          currentHour++;
          continue;
        }

        const slotTimeStr = `${String(currentHour).padStart(2, '0')}:00～${String(currentHour + 1).padStart(2, '0')}:00`;
        const booked = dailyBookings[slotTimeStr] || 0;
        
        // 過去の日時または今日の過去時間は予約不可にする
        const isPast = (targetDateStr < todayStr) || (targetDateStr === todayStr && currentHour <= nowHour);
        const maxSlots = storeSettings.maxSlots;

        dayResult.slots.push({
          time: slotTimeStr,
          max: maxSlots,
          booked: booked,
          available: !isPast && (booked < maxSlots),
          isPast: isPast
        });

        currentHour++;
      }

      weeklySlots.push(dayResult);
    }

    return NextResponse.json(weeklySlots);
  } catch (error: any) {
    console.error('Calendar API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
