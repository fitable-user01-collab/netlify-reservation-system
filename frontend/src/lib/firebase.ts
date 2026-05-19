import * as admin from 'firebase-admin';

// private keyの改行コードを正しく処理する
const formatPrivateKey = (key: string | undefined): string | undefined => {
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n');
};

const getFirebaseAdmin = () => {
  // すでに初期化されている場合はそのアプリを使用する
  if (admin.apps.length > 0) {
    return admin.app();
  }

  // 必要な環境変数が揃っている場合はサービスアカウントで初期化
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (projectId && clientEmail && privateKey) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  // ローカル開発などでFirebase CLIログインやエミュレータを使用している場合のフォールバック
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
    return admin.initializeApp({
      projectId: projectId || 'demo-project',
    });
  }

  // デプロイ本番用 (VercelでGCPサービスアカウント情報が入っている想定)
  throw new Error(
    'Firebase Admin configuration error: Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY in environment variables.'
  );
};

const app = getFirebaseAdmin();
export const db = admin.firestore(app);
