import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { authPin, stores, renames } = await req.json();

    if (!Array.isArray(stores)) {
      return NextResponse.json({ success: false, error: '店舗リストの形式が正しくありません。' }, { status: 400 });
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

    // 2. 店舗名の変更に伴うマイグレーション処理
    // PostgreSQL の ON UPDATE CASCADE 制約により、親である stores の主キー(name)を更新するだけで、
    // 子テーブル（store_settings, holidays, bookings）の店舗名が一括かつ自動的に連動更新されます！
    if (renames && typeof renames === 'object') {
      for (const [oldName, newName] of Object.entries(renames)) {
        if (!oldName || !newName || oldName === newName) continue;
        
        const { error: renameError } = await supabase
          .from('stores')
          .update({ name: newName })
          .eq('name', oldName);
        
        if (renameError) throw renameError;
      }
    }

    // 3. 削除対象の店舗を処理する
    const { data: existingStores, error: getStoresError } = await supabase
      .from('stores')
      .select('name');
    
    if (getStoresError) throw getStoresError;

    const existingStoreNames = (existingStores || []).map(s => s.name);
    const newStoreNames = new Set(stores.map((s: any) => s.店舗名).filter(Boolean));

    // 送信データにない既存店舗を削除する
    const storesToDelete = existingStoreNames.filter(name => !newStoreNames.has(name));
    if (storesToDelete.length > 0) {
      const { error: deleteError } = await supabase
        .from('stores')
        .delete()
        .in('name', storesToDelete);
      
      if (deleteError) throw deleteError;
    }

    // 4. 各店舗情報を登録・更新する (upsert)
    const upsertRows = stores
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

    if (upsertRows.length > 0) {
      const { error: upsertError } = await supabase
        .from('stores')
        .upsert(upsertRows, { onConflict: 'name' });

      if (upsertError) throw upsertError;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Save Stores API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
