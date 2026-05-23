import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { authPin, config } = await req.json();

    if (!config) {
      return NextResponse.json({ success: false, error: '設定内容が指定されていません。' }, { status: 400 });
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

    // 2. システム設定 (system_config テーブルの key = 'global') の保存 (upsert)
    const { error: upsertError } = await supabase
      .from('system_config')
      .upsert({ key: 'global', config }, { onConflict: 'key' });

    if (upsertError) throw upsertError;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Save System Config API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
