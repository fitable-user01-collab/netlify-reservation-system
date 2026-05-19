import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export async function POST(req: Request) {
  try {
    const { pin } = await req.json();

    if (!pin) {
      return NextResponse.json({ success: false, error: 'PINコードを入力してください。' }, { status: 400 });
    }

    const globalDoc = await db.collection('system_config').doc('global').get();
    const globalConfig = globalDoc.exists ? globalDoc.data() : null;
    const adminPin = globalConfig?.ADMIN_PIN || '1234';

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
