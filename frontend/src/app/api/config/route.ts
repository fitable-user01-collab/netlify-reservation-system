import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // 1. システム設定の取得 (system_config テーブルの key = 'global')
    const { data: configData, error: configError } = await supabase
      .from('system_config')
      .select('config')
      .eq('key', 'global')
      .single();

    if (configError && configError.code !== 'PGRST116') { // PGRST116: 該当レコードなし
      throw configError;
    }
    const config = configData?.config || { ADMIN_PIN: '1234' };

    // 2. 店舗一覧の取得 (stores テーブル)
    const { data: storesData, error: storesError } = await supabase
      .from('stores')
      .select('*');

    if (storesError) {
      throw storesError;
    }

    // 日本語カラム名にマッピングしてフロントに返す（フロントエンドの既存コードと互換性を保つ）
    const stores = (storesData || []).map(item => ({
      店舗名: item.name,
      住所: item.address || '',
      電話番号: item.phone || '',
      カレンダーID: item.calendar_id || '',
      WebhookURL: item.webhook_url || '',
      メール持ち物: item.email_items || '',
      メール来店案内: item.email_visit || '',
      利用規約: item.terms_of_service || '',
      プラン名: item.plan_name || '',
      通常価格: item.normal_price || '',
      キャンペーン価格: item.campaign_price || '',
      キャンペーン備考: item.campaign_notes || ''
    }));

    return NextResponse.json({ config, stores }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });
  } catch (error: any) {
    console.error('Config API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
