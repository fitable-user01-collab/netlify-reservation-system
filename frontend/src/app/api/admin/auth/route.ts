import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { pin } = await req.json();

    if (!pin) {
      return NextResponse.json({ success: false, error: 'PINコードを入力してください。' }, { status: 400 });
    }

    // system_config からグローバル設定を取得
    const { data: configData, error: configError } = await supabase
      .from('system_config')
      .select('config')
      .eq('key', 'global')
      .single();

    if (configError && configError.code !== 'PGRST116') {
      throw configError;
    }

    const adminPin = configData?.config?.ADMIN_PIN || '1234';

    if (String(pin) === String(adminPin)) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ success: false, error: 'PINコードが正しくありません。' }, { status: 401 });
    }
  } catch (error: any) {
    console.error('Admin Auth API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
