import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { authPin, store, settings, holidays, specialSchedules } = await req.json();

    if (!store) {
      return NextResponse.json({ success: false, error: '店舗名が指定されていません。' }, { status: 400 });
    }

    // 1. セキュリティ認証
    const { data: configData } = await supabase
      .from('system_config')
      .select('config')
      .eq('key', 'global')
      .single();
    
    const adminPin = configData?.config?.ADMIN_PIN || '1234';

    if (String(authPin) !== String(adminPin)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. 曜日設定の保存 (store_settings テーブルへの upsert)
    if (Array.isArray(settings)) {
      const upsertRows = settings
        .filter((set: any) => set.day)
        .map((set: any) => ({
          store_name: store,
          day_name: set.day,
          active: set.active === true || set.active === 'true',
          start_time: set.start || '09:00',
          end_time: set.end || '21:00',
          break_start: set.breakStart || '',
          break_end: set.breakEnd || '',
          max_slots: parseInt(set.maxSlots, 10) || 1
        }));

      if (upsertRows.length > 0) {
        const { error: upsertError } = await supabase
          .from('store_settings')
          .upsert(upsertRows, { onConflict: 'store_name,day_name' });
        
        if (upsertError) throw upsertError;
      }
    }

    // 3. 休日設定の保存 (holidays テーブル)
    if (Array.isArray(holidays)) {
      // 既存の当該店舗の休日を削除
      const { error: deleteError } = await supabase
        .from('holidays')
        .delete()
        .eq('store_name', store);

      if (deleteError) throw deleteError;

      // 新しい休日を登録
      const insertHolidays = holidays
        .filter((dateStr: string) => dateStr)
        .map((dateStr: string) => ({
          store_name: store,
          date: dateStr // YYYY/MM/DD形式
        }));

      if (insertHolidays.length > 0) {
        const { error: insertError } = await supabase
          .from('holidays')
          .insert(insertHolidays);
        
        if (insertError) throw insertError;
      }
    }

    // 4. 特別スケジュールの保存 (special_schedules テーブル)
    if (Array.isArray(specialSchedules)) {
      // 既存の当該店舗の特別スケジュールを一旦すべて削除
      const { error: deleteSpecialError } = await supabase
        .from('special_schedules')
        .delete()
        .eq('store_name', store);

      if (deleteSpecialError) throw deleteSpecialError;

      // 新しい特別スケジュールを登録
      const insertSpecialRows = specialSchedules
        .filter((s: any) => s.date)
        .map((s: any) => ({
          store_name: store,
          date: s.date,
          active: s.active === true || s.active === 'true',
          start_time: s.start || '09:00',
          end_time: s.end || '21:00',
          break_start: s.breakStart || '',
          break_end: s.breakEnd || '',
          max_slots: parseInt(s.maxSlots, 10) || 1
        }));

      if (insertSpecialRows.length > 0) {
        const { error: insertSpecialError } = await supabase
          .from('special_schedules')
          .insert(insertSpecialRows);

        if (insertSpecialError) throw insertSpecialError;
      }
    }

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
    const { data: configData } = await supabase
      .from('system_config')
      .select('config')
      .eq('key', 'global')
      .single();
    
    const adminPin = configData?.config?.ADMIN_PIN || '1234';

    if (String(authPin) !== String(adminPin)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. 曜日設定の取得 (store_settings テーブル)
    const { data: settingsData, error: settingsError } = await supabase
      .from('store_settings')
      .select('*')
      .eq('store_name', store);

    if (settingsError) throw settingsError;

    const settings = (settingsData || []).map(item => ({
      day: item.day_name,
      active: item.active,
      start: item.start_time,
      end: item.end_time,
      breakStart: item.break_start,
      breakEnd: item.break_end,
      maxSlots: item.max_slots
    }));

    // デフォルト曜日定義とマージ
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
    const { data: holidaysData, error: holidaysError } = await supabase
      .from('holidays')
      .select('date')
      .eq('store_name', store);

    if (holidaysError) throw holidaysError;
    
    const holidays = (holidaysData || [])
      .map(item => item.date)
      .filter(Boolean);

    holidays.sort();

    // 4. 特別スケジュールの取得
    const { data: specialSchedulesData, error: specialSchedulesError } = await supabase
      .from('special_schedules')
      .select('*')
      .eq('store_name', store)
      .order('date', { ascending: true });

    if (specialSchedulesError) throw specialSchedulesError;

    const specialSchedules = (specialSchedulesData || []).map(item => ({
      date: item.date,
      active: item.active,
      start: item.start_time,
      end: item.end_time,
      breakStart: item.break_start,
      breakEnd: item.break_end,
      maxSlots: item.max_slots
    }));

    return NextResponse.json({ settings: finalSettings, holidays, specialSchedules });
  } catch (error: any) {
    console.error('Get Settings API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
