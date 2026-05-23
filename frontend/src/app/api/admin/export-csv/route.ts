import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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
    const { data: configData } = await supabase
      .from('system_config')
      .select('config')
      .eq('key', 'global')
      .single();
    
    const adminPin = configData?.config?.ADMIN_PIN || '1234';

    if (String(authPin) !== String(adminPin)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. 該当月の開始日と終了日を算出
    const [year, month] = yearMonth.split('-').map(Number);
    const startDateStr = `${year}/${String(month).padStart(2, '0')}/01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDateStr = `${year}/${String(month).padStart(2, '0')}/${String(lastDay).padStart(2, '0')}`;

    // 3. Supabaseより全店舗の対象月の予約データを日付・時間・店舗名順で取得
    const { data: bookingsData, error: bookingsError } = await supabase
      .from('bookings')
      .select('*')
      .gte('date', startDateStr)
      .lte('date', endDateStr)
      .order('date', { ascending: true })
      .order('time', { ascending: true })
      .order('store_name', { ascending: true });

    if (bookingsError) {
      throw bookingsError;
    }

    const reservations = (bookingsData || []).map(b => ({
      bookingId: b.id,
      timestamp: b.timestamp || '',
      status: b.status || '予約確定',
      name: b.name || '',
      kana: b.kana || '',
      phone: b.phone || '',
      email: b.email || '',
      date: b.date || '',
      time: b.time || '',
      store: b.store_name || '',
      notes: b.notes || ''
    }));

    return NextResponse.json({ success: true, reservations });
  } catch (error: any) {
    console.error('Export CSV API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
