/**
 * スプレッドシートからFirebaseへデータを移行するGAS関数
 * 
 * Vercelにデプロイした後、この関数を実行することで
 * すべてのスプレッドシートデータがFirestoreへ移行されます。
 */

// TODO: デプロイ後に実際のVercelのURLに変更してください（例: 'https://xxx.vercel.app'）
const VERCEL_APP_URL = 'YOUR_VERCEL_APP_URL_HERE';
const ADMIN_PIN = '1234'; // システム設定のADMIN_PINと同じもの

function runFirebaseMigration() {
  const vercelUrl = VERCEL_APP_URL.replace(/\/$/, '');
  if (vercelUrl.includes('YOUR_VERCEL_APP_URL_HERE')) {
    Logger.log('⚠️ エラー: VERCEL_APP_URL に実際のデプロイ先URLを設定してください。');
    return;
  }

  Logger.log('🔄 データ移行処理を開始します...');

  const payload = {
    authPin: ADMIN_PIN,
    stores: getSheetDataAsJson('店舗基本情報'),
    settings: getSheetDataAsJson('店舗・枠設定'),
    holidays: getSheetDataAsJson('休日設定'),
    systemConfig: getSheetDataAsJson('システム設定'),
    bookings: getSheetDataAsJson('予約データ')
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(vercelUrl + '/api/admin/migrate-from-sheet', options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    Logger.log('Response Code: ' + responseCode);
    Logger.log('Response Body: ' + responseText);

    if (responseCode === 200) {
      const resJson = JSON.parse(responseText);
      if (resJson.success) {
        Logger.log('🎉 成功: スプレッドシートからFirebaseへのデータ移行が正常に完了しました！');
      } else {
        Logger.log('❌ 失敗: ' + resJson.error);
      }
    } else {
      Logger.log('❌ エラーが発生しました。HTTPステータス: ' + responseCode);
    }
  } catch (e) {
    Logger.log('❌ 送信エラー: ' + e.message);
  }
}

/**
 * 指定されたシートのデータをヘッダー付きのJSONオブジェクト配列として取得する
 */
function getSheetDataAsJson(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('⚠️ シートが見つかりません: ' + sheetName);
    return [];
  }

  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  const jsonArray = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const item = {};
    let hasData = false;

    for (let j = 0; j < headers.length; j++) {
      const headerName = headers[j];
      let val = row[j];

      // 日付や特殊なオブジェクトの処理
      if (val instanceof Date) {
        if (sheetName === '休日設定' || headerName === '体験日') {
          // 日付のみ (YYYY/MM/DD)
          val = Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy/MM/dd');
        } else if (headerName === '予約日時') {
          // タイムスタンプ (YYYY/MM/DD HH:mm:ss)
          val = Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
        } else if (headerName === '開始時間' || headerName === '終了時間' || headerName === '休憩開始' || headerName === '休憩終了') {
          // 時間のみ (HH:mm)
          val = Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm');
        }
      }

      if (val !== undefined && val !== null && val !== '') {
        hasData = true;
      }
      
      // 電話番号などの頭のシングルクォーテーションを除去
      if (typeof val === 'string' && val.startsWith("'")) {
        val = val.substring(1);
      }

      item[headerName] = val;
    }

    if (hasData) {
      jsonArray.push(item);
    }
  }

  return jsonArray;
}
