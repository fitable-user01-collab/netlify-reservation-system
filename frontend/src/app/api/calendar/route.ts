import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    // 2. 店舗別・曜日別のスケジュール設定をSupabaseから取得
    const { data: settingsData, error: settingsError } = await supabase
      .from('store_settings')
      .select('*')
      .eq('store_name', store);

    if (settingsError) throw settingsError;

    const storeSettingsMap: Record<string, any> = {};
    (settingsData || []).forEach(item => {
      storeSettingsMap[item.day_name] = {
        active: item.active,
        start: item.start_time,
        end: item.end_time,
        breakStart: item.break_start,
        breakEnd: item.break_end,
        maxSlots: item.max_slots
      };
    });

    // 3. 店舗個別の休館日情報をSupabaseから取得
    const { data: holidaysData, error: holidaysError } = await supabase
      .from('holidays')
      .select('date')
      .eq('store_name', store)
      .gte('date', startDateStr)
      .lte('date', endDateStr);

    if (holidaysError) throw holidaysError;
    
    const storeHolidaysSet = new Set<string>();
    (holidaysData || []).forEach(item => {
      if (item.date) {
        storeHolidaysSet.add(item.date);
      }
    });

    // 3.5 店舗個別の特別スケジュール情報をSupabaseから取得 (短縮営業など)
    // データベースの日付形式（YYYY-MM-DD）に変換して検索クエリを投げます
    const startHyphen = startDateStr.replace(/\//g, '-');
    const endHyphen = endDateStr.replace(/\//g, '-');

    const { data: specialSchedulesData, error: specialSchedulesError } = await supabase
      .from('special_schedules')
      .select('*')
      .eq('store_name', store)
      .gte('date', startHyphen)
      .lte('date', endHyphen);

    if (specialSchedulesError) throw specialSchedulesError;

    const specialSchedulesMap: Record<string, any> = {};
    (specialSchedulesData || []).forEach(item => {
      if (item.date) {
        // カレンダー表示側（YYYY/MM/DD）の形式にキーをマッピング
        const slashDate = item.date.replace(/-/g, '/');
        specialSchedulesMap[slashDate] = {
          active: item.active,
          start: item.start_time,
          end: item.end_time,
          breakStart: item.break_start,
          breakEnd: item.break_end,
          maxSlots: item.max_slots
        };
      }
    });

    // 4. 期間内の確定予約件数をSupabaseから取得
    const { data: bookingsData, error: bookingsError } = await supabase
      .from('bookings')
      .select('date, time')
      .eq('store_name', store)
      .eq('status', '予約確定')
      .gte('date', startDateStr)
      .lte('date', endDateStr);

    if (bookingsError) throw bookingsError;

    // 予約状況マップを作成: { "2026/05/19": { "09:00～10:00": 1, ... } }
    const bookingCountsMap: Record<string, Record<string, number>> = {};
    (bookingsData || []).forEach(b => {
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

      if (nationalHolidays.has(targetDateStr)) {
        dayName = '祝';
      }

      const dayResult = {
        date: targetDateStr,
        dayName: dayName,
        slots: [] as any[]
      };

      if (storeHolidaysSet.has(targetDateStr)) {
        weeklySlots.push(dayResult);
        continue;
      }

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

      // 特別スケジュールが登録されている日付は、そちらを最優先で上書き（オーバーライド）
      const specialSettings = specialSchedulesMap[targetDateStr];
      if (specialSettings) {
        storeSettings = specialSettings;
      }

      if (!storeSettings.active) {
        weeklySlots.push(dayResult);
        continue;
      }

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
        if (currentHour >= bStartHour && currentHour < bEndHour) {
          currentHour++;
          continue;
        }

        const slotTimeStr = `${String(currentHour).padStart(2, '0')}:00～${String(currentHour + 1).padStart(2, '0')}:00`;
        const booked = dailyBookings[slotTimeStr] || 0;
        
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

    return NextResponse.json(weeklySlots, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error: any) {
    console.error('Calendar API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
