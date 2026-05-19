import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. システム設定の取得 (system_config/global)
    const globalConfigDoc = await db.collection('system_config').doc('global').get();
    const config = globalConfigDoc.exists ? globalConfigDoc.data() : { ADMIN_PIN: '1234' };

    // 2. 店舗一覧の取得 (stores コレクション)
    const storesSnapshot = await db.collection('stores').get();
    const stores: any[] = [];

    storesSnapshot.forEach(doc => {
      stores.push({
        店舗名: doc.id,
        ...doc.data()
      });
    });

    return NextResponse.json({ config, stores });
  } catch (error: any) {
    console.error('Config API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
