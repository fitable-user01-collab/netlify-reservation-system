import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { authPin, stores, settings, holidays, systemConfig, bookings } = body;

    // 1. PINコードによる簡易セキュリティ認証
    const expectedPin = process.env.ADMIN_PIN || '1234';
    if (authPin !== expectedPin) {
      return NextResponse.json({ success: false, error: 'Unauthorized: Invalid authPin' }, { status: 401 });
    }

    // 2. 店舗基本情報の登録 (stores テーブル)
    if (Array.isArray(stores)) {
      const rows = stores
        .filter((s: any) => s.店舗名)
        .map((s: any) => ({
          name: s.店舗名,
          address: s.住所 || '',
          phone: s.電話番号 || '',
          calendar_id: s.カレンダーID || '',
          webhook_url: s.WebhookURL || '',
          email_items: s.メール持ち物 || '',
          email_visit: s.メール来店案内 || '',
          terms_of_service: s.利用規約 || '',
          plan_name: s.プラン名 || '',
          normal_price: s.通常価格 || '',
          campaign_price: s.キャンペーン価格 || '',
          campaign_notes: s.キャンペーン備考 || ''
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('stores')
          .upsert(rows, { onConflict: 'name' });
        
        if (error) throw error;
      }
    }

    // 3. 曜日別・店舗別スケジュール設定の登録 (store_settings テーブル)
    if (Array.isArray(settings)) {
      const rows = settings
        .filter((set: any) => set.店舗 && set.曜日)
        .map((set: any) => ({
          store_name: set.店舗,
          day_name: set.曜日,
          active: set.営業フラグ === true || set.営業フラグ === 'true' || set.営業フラグ === 'TRUE' || set.営業フラグ === 1,
          start_time: set.開始時間 || '09:00',
          end_time: set.終了時間 || '21:00',
          break_start: set.休憩開始 || '',
          break_end: set.休憩終了 || '',
          max_slots: parseInt(set.最大枠数, 10) || 1
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('store_settings')
          .upsert(rows, { onConflict: 'store_name,day_name' });
        
        if (error) throw error;
      }
    }

    // 4. 休館日情報の登録 (holidays テーブル)
    if (Array.isArray(holidays)) {
      // 既存の休日を一度全件削除
      const { error: deleteError } = await supabase
        .from('holidays')
        .delete()
        .neq('id', 0); // ダミークエリで全削除
      
      if (deleteError) throw deleteError;

      const rows = holidays
        .filter((h: any) => h.店舗 && h.年月日)
        .map((h: any) => ({
          store_name: h.店舗,
          date: h.年月日 // YYYY/MM/DD形式
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('holidays')
          .insert(rows);
        
        if (error) throw error;
      }
    }

    // 5. システム設定の登録 (system_config テーブル)
    if (Array.isArray(systemConfig)) {
      const configObj: Record<string, any> = {};
      systemConfig.forEach((c: any) => {
        if (!c.設定名) return;
        configObj[c.設定名] = c.設定値;
      });

      const { error } = await supabase
        .from('system_config')
        .upsert({ key: 'global', config: configObj }, { onConflict: 'key' });
      
      if (error) throw error;
    }

    // 6. 予約履歴データの登録 (bookings テーブル)
    if (Array.isArray(bookings)) {
      const rows = bookings
        .filter((b: any) => b.予約番号)
        .map((b: any) => ({
          id: b.予約番号,
          timestamp: b.予約日時 || '',
          status: b.ステータス || '予約確定',
          name: b.氏名 || '',
          kana: b.フリガナ || '',
          phone: b.電話番号 || '',
          email: b.メールアドレス || '',
          store_name: b.店舗 || '',
          date: b.体験日 || '',
          time: b.時間帯 || '',
          event_id: b.イベントID || ''
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('bookings')
          .upsert(rows, { onConflict: 'id' });
        
        if (error) throw error;
      }
    }

    return NextResponse.json({ success: true, message: 'スプレッドシートのデータをSupabaseへ正常に移行しました。' });
  } catch (error: any) {
    console.error('Migration API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
