import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function POST(req: Request) {
  try {
    const { authPin, config } = await req.json();

    if (!config) {
      return NextResponse.json({ success: false, error: '設定内容が指定されていません。' }, { status: 400 });
    }

    // 1. セキュリティ認証
    const globalDoc = await db.collection('system_config').doc('global').get();
    const adminPin = globalDoc.exists ? globalDoc.data()?.ADMIN_PIN : '1234';

    if (String(authPin) !== String(adminPin)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. システム設定 (system_config/global) の保存
    const ref = db.collection('system_config').doc('global');
    await ref.set(config, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Save System Config API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
