/**
 * ジム体験予約システム Backend (GAS)
 */

const SHEET_BOOKINGS = '予約データ';
const SHEET_SETTINGS = '店舗・枠設定';
const SHEET_HOLIDAYS = '休日設定';
const SHEET_STORES = '店舗基本情報';
const SHEET_SYSTEM_CONFIG = 'システム設定';

// グローバル変数による初期化管理
let sheetsEnsured = false;

function doGet(e) {
  // 初回のみシート確認を行うように調整
  ensureSheetsOnce();
  
  const template = HtmlService.createTemplateFromFile('index');
  template.page = e.parameter.page || 'user';
  return template.evaluate()
    .setTitle('ジム体験予約システム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 必要なシートが存在するか確認し、なければ作成する（一度だけ実行）
 */
function ensureSheetsOnce() {
  if (sheetsEnsured) return;
  ensureSheets();
  sheetsEnsured = true;
}

function ensureSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets().map(s => s.getName());
  
  // 1. 予約データシート
  if (!sheets.includes(SHEET_BOOKINGS)) {
    const sheet = ss.insertSheet(SHEET_BOOKINGS);
    sheet.appendRow(['予約番号', '予約日時', 'ステータス', '氏名', 'フリガナ', '電話番号', 'メールアドレス', '店舗', '体験日', '時間帯', 'イベントID']);
  }
  
  // 2. 店舗・枠設定シート
  if (!sheets.includes(SHEET_SETTINGS)) {
    const sheet = ss.insertSheet(SHEET_SETTINGS);
    sheet.appendRow(['店舗', '曜日', '営業フラグ', '開始時間', '終了時間', '休憩開始', '休憩終了', '最大枠数']);
  }
  
  // 3. 休日設定シート
  if (!sheets.includes(SHEET_HOLIDAYS)) {
    const sheet = ss.insertSheet(SHEET_HOLIDAYS);
    sheet.appendRow(['店舗', '年月日']);
  }
 
  // 4. 店舗基本情報シート
  if (!sheets.includes(SHEET_STORES)) {
    const sheet = ss.insertSheet(SHEET_STORES);
    sheet.appendRow(['店舗名', '住所', '電話番号', 'カレンダーID', 'WebhookURL', 'メール持ち物', 'メール来店案内', '利用規約', 'プラン名', '通常価格', 'キャンペーン価格', 'キャンペーン備考']);
    sheet.appendRow(['FITABLE西京極店', '京都府京都市右京区...', '075-xxx-xxxx', 'primary', '', '・室内用シューズ\n・タオル', '10分前にお越しください', '第1条...', '体験トレーニング', '価格1,650円(税込)', '0円', '※キャンペーン適用にはアンケートへのご回答が必要です。']);
  }

  // 5. システム設定シート
  if (!sheets.includes(SHEET_SYSTEM_CONFIG)) {
    const sheet = ss.insertSheet(SHEET_SYSTEM_CONFIG);
    sheet.appendRow(['設定名', '設定値', '備考']);
    sheet.appendRow(['ADMIN_PIN', '1234', '管理画面ログイン用PIN']);
  }
}

/**
 * 予約を保存する（フロントから google.script.run.withSuccessHandler().submitBooking(data) で呼ばれる）
 */
function getStoreBasicInfo(storeName) {
  ensureSheets();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_STORES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(storeName).trim()) {
      const store = {};
      for (let j = 0; j < headers.length; j++) {
        store[headers[j]] = data[i][j];
      }
      return store;
    }
  }
  return null;
}

/**
 * 予約を保存する
 */
function submitBooking(data) {
  ensureSheetsOnce();
  const lock = LockService.getScriptLock();
  try {
    // 30秒間ロックを試みる
    lock.waitLock(30000);
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_BOOKINGS);

    const bookingId = generateShortBookingId();
    const timestamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');

    const appCfg = getAppConfig();
    const config = appCfg.config;

    const storeInfo = getStoreBasicInfo(data.store);
    const calendarId = (storeInfo && storeInfo.カレンダーID) ? storeInfo.カレンダーID : (config.DEFAULT_CALENDAR_ID || 'primary');

    // Googleカレンダー登録
    const eventId = createCalendarEvent(data, calendarId);

    sheet.appendRow([
      bookingId,
      timestamp,
      '予約確定',
      data.name,
      data.kana,
      "'" + data.phone, // 電話番号を文字列として保存
      data.email,
      data.store,
      data.date,
      data.time,
      eventId || ''
    ]);

    // キャッシュをクリア（予約状況が変わったため）
    const cache = CacheService.getScriptCache();
    cache.remove(`weekly_slots_${data.store}_${data.date}`);
    cache.remove(`weekly_slots_${data.store}`); // 汎用キーも削除

    // 予約完了メール送信
    const mailSuccess = sendConfirmationEmail(data, bookingId, storeInfo, config);

    // Google Chat通知
    const webhookUrl = (storeInfo && storeInfo.WebhookURL) ? storeInfo.WebhookURL : (config.DEFAULT_WEBHOOK_URL || '');
    sendChatNotification(data, bookingId, webhookUrl, !mailSuccess);

    return { success: true, bookingId: bookingId };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 既存の予約をキャンセルする
 */
function cancelBooking(bookingId, email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_BOOKINGS);
    if (!sheet) return { success: false, error: '予約データが見つかりません' };

    const data = sheet.getDataRange().getValues();
    // ヘッダー行をスキップ
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === bookingId && data[i][6] === email) {
        // ステータスをキャンセルに変更
        sheet.getRange(i + 1, 3).setValue('キャンセル');
        
        // カレンダーイベント削除
        const storeName = data[i][7];
        const eventId = data[i][10];
        if (eventId) {
          const storeInfo = getStoreBasicInfo(storeName);
          const appCfg = getAppConfig();
          const calendarId = (storeInfo && storeInfo.カレンダーID) ? storeInfo.カレンダーID : (appCfg.config.DEFAULT_CALENDAR_ID || 'primary');
          deleteCalendarEvent(eventId, calendarId);
        }
        
        return { success: true, name: data[i][3] };
      }
    }
    return { success: false, error: '該当する予約が見つかりません' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Googleカレンダー登録
 */
function createCalendarEvent(data, calendarId) {
  const calId = calendarId || 'primary';
  const cal = CalendarApp.getCalendarById(calId);

  if (cal) {
    const title = '【体験予約】' + data.name + '様 (' + data.store + ')';
    const timeParts = data.time.split('～');
    const [startHour, startMin] = timeParts[0].split(':');
    const [endHour, endMin] = timeParts[1].split(':');

    const dateStr = data.date.replace(/\//g, '-');
    const startTime = new Date(dateStr + 'T' + startHour + ':' + startMin + ':00+09:00');
    const endTime = new Date(dateStr + 'T' + endHour + ':' + endMin + ':00+09:00');

    const event = cal.createEvent(title, startTime, endTime, {
      description: '電話番号: ' + data.phone + '\nメールアドレス: ' + data.email + '\n店舗: ' + data.store
    });
    return event.getId();
  }
  return null;
}

function deleteCalendarEvent(eventId, calendarId) {
  try {
    const calId = calendarId || 'primary';
    const cal = CalendarApp.getCalendarById(calId);
    if (cal) {
      const event = cal.getEventById(eventId);
      if (event) {
        event.deleteEvent();
      }
    }
  } catch (e) {
    console.log('Calendar event delete error:', e.message);
  }
}

/**
 * 6桁の短縮予約番号を生成する
 */
function generateShortBookingId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見間違いやすい I, O, 0, 1 を除外
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 確認メール送信
 */
/**
 * 確認メール送信
 */
function sendConfirmationEmail(data, bookingId, storeInfo, config) {
  // 管理画面からの登録（ダミーアドレス）や空の場合は送信しない
  if (!data.email || data.email === 'admin@example.com' || data.email.includes('example.com')) {
    console.log('Skipping email for admin registration or invalid address');
    return true;
  }

  const subject = '【ジム体験予約】ご予約を受け付けました';

  const scriptUrl = ScriptApp.getService().getUrl();
  const cancelUrl = scriptUrl + '?page=cancel';

  const address = storeInfo ? storeInfo.住所 : '（住所未登録）';
  const phone = storeInfo ? storeInfo.電話番号 : '（電話番号未登録）';
  const mailItems = (storeInfo && storeInfo.メール持ち物) ? storeInfo.メール持ち物 : (config.DEFAULT_EMAIL_ITEMS || '');
  const mailVisit = (storeInfo && storeInfo.メール来店案内) ? storeInfo.メール来店案内 : (config.DEFAULT_EMAIL_VISIT || '');

  const planName = (storeInfo && storeInfo.プラン名) ? storeInfo.プラン名 : (config.DEFAULT_PLAN_NAME || '体験トレーニング');
  const campaignPrice = (storeInfo && storeInfo.キャンペーン価格) ? storeInfo.キャンペーン価格 : (config.DEFAULT_CAMPAIGN_PRICE || '');
  const normalPrice = (storeInfo && storeInfo.通常価格) ? storeInfo.通常価格 : (config.DEFAULT_NORMAL_PRICE || '');

  let priceText = '';
  if (!campaignPrice || campaignPrice === 'なし' || campaignPrice === '0') {
    priceText = normalPrice;
  } else {
    priceText = campaignPrice;
  }

  let body = data.name + ' 様\n\n' +
    'この度はFITABLEの無料体験にご予約いただき、誠にありがとうございます。\n' +
    '以下の内容でご予約を承りました。\n\n' +
    '■ご予約内容\n' +
    '【予約番号】 ' + bookingId + '\n' +
    '【店舗】 ' + data.store + '\n' +
    '【ご来店日時】 ' + data.date + ' ' + data.time + '\n' +
    '【プラン】 ' + planName + '\n' +
    '【料金】 ' + priceText + '\n\n' +
    '■店舗情報\n' +
    '【住所】 ' + address + '\n' +
    '【電話番号】 ' + phone + '\n';

  if (mailItems) {
    body += '\n■当日の持ち物案内\n' + mailItems + '\n';
  }
  if (mailVisit) {
    body += '\n■ご来店について\n' + mailVisit + '\n';
  }

  body += '\n' +
    '※万が一、ご都合が悪くなった場合は、以下のURLよりキャンセル手続きをお願いいたします。\n' +
    'キャンセルURL: ' + cancelUrl + '\n' +
    '予約番号とメールアドレスが必要になります。\n\n' +
    '当日お会いできることをスタッフ一同楽しみにしております。\n';

  try {
    GmailApp.sendEmail(data.email, subject, body, {
      name: 'FITABLE 体験予約窓口'
    });
    return true;
  } catch (mailError) {
    console.error('Failed to send confirmation email to ' + data.email + ': ' + mailError.message);
    return false;
  }
}

/**
 * Google Chat通知
 */
/**
 * Google Chat通知
 */
function sendChatNotification(data, bookingId, webhookUrl, emailFailed) {
  if (!webhookUrl || webhookUrl === 'YOUR_GOOGLE_CHAT_WEBHOOK_URL_HERE') return;

  const emailWarning = emailFailed ? ' ⚠️ *【メールの送信に失敗しました。メールアドレスが不正の可能性があります】*' : '';

  let text = `*新規体験予約が入りました!*\n` +
             `・店舗: ${data.store}\n` +
             `・日時: ${data.date} ${data.time}\n` +
             `・お名前: ${data.name} 様 (${data.kana || ''})\n` +
             `・電話番号: ${data.phone || ''}\n` +
             `・メール: ${data.email || ''}${emailWarning}\n` +
             `・予約番号: ${bookingId}`;

  const payload = {
    "text": text
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };

  UrlFetchApp.fetch(webhookUrl, options);
}

/**
 * 稼働時間と既存予約から、選択された日の空き枠リストを返す
 */
function getAvailableSlots(store, dateStr) {
  ensureSheets();
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. 店舗の曜日設定を取得
    const dateObj = new Date(dateStr);
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    let dayName = dayNames[dateObj.getDay()];

    // 祝日判定
    if (isNationalHoliday(dateObj)) {
      dayName = '祝';
    }

    let storeSettings = [];
    const settingsSheet = ss.getSheetByName(SHEET_SETTINGS);
    if (settingsSheet) {
      const data = settingsSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === store && data[i][1] === dayName) {
          storeSettings = {
            active: data[i][2],
            start: data[i][3],
            end: data[i][4],
            breakStart: data[i][5],
            breakEnd: data[i][6],
            maxSlots: data[i][7] || 1
          };
          break;
        }
      }
    }

    // 設定がない場合はデフォルト設定を使用
    if (!storeSettings || Object.keys(storeSettings).length === 0) {
      storeSettings = {
        active: true,
        start: '09:00', end: '21:00',
        breakStart: '13:00', breakEnd: '14:00',
        maxSlots: 1
      };
    }

    if (!storeSettings.active) {
      return []; // その曜日は営業していない
    }

    // ★休館日チェック
    const holidaysSheet = ss.getSheetByName(SHEET_HOLIDAYS);
    if (holidaysSheet) {
      const hData = holidaysSheet.getDataRange().getValues();
      for (let i = 1; i < hData.length; i++) {
        const hDateStr = (hData[i][1] instanceof Date) ? Utilities.formatDate(hData[i][1], 'Asia/Tokyo', 'yyyy/MM/dd') : String(hData[i][1]);
        if (hData[i][0] === store && hDateStr === dateStr) {
          return []; // 休館日として設定されているため空き枠なし
        }
      }
    }

    // 2. 営業時間から基本の枠を生成 (1時間ごと)
    const defaultSlots = [];
    const startStr = (storeSettings.start instanceof Date) ? Utilities.formatDate(storeSettings.start, 'Asia/Tokyo', 'HH:mm') : String(storeSettings.start);
    const endStr = (storeSettings.end instanceof Date) ? Utilities.formatDate(storeSettings.end, 'Asia/Tokyo', 'HH:mm') : String(storeSettings.end);
    let currentHour = parseInt(startStr.split(':')[0], 10);
    const endHour = parseInt(endStr.split(':')[0], 10);

    let bStartHour = -1;
    let bEndHour = -1;
    if (storeSettings.breakStart) {
      const bsStr = (storeSettings.breakStart instanceof Date) ? Utilities.formatDate(storeSettings.breakStart, 'Asia/Tokyo', 'HH:mm') : String(storeSettings.breakStart);
      bStartHour = parseInt(bsStr.split(':')[0], 10);
    }
    if (storeSettings.breakEnd) {
      const beStr = (storeSettings.breakEnd instanceof Date) ? Utilities.formatDate(storeSettings.breakEnd, 'Asia/Tokyo', 'HH:mm') : String(storeSettings.breakEnd);
      bEndHour = parseInt(beStr.split(':')[0], 10);
    }

    while (currentHour < endHour) {
      // 休憩時間の判定
      if (currentHour >= bStartHour && currentHour < bEndHour) {
        currentHour++;
        continue;
      }
      const slotStr = `${String(currentHour).padStart(2, '0')}:00～${String(currentHour + 1).padStart(2, '0')}:00`;
      defaultSlots.push(slotStr);
      currentHour++;
    }

    // 3. 予約状況の確認
    const sheet = ss.getSheetByName(SHEET_BOOKINGS);
    if (!sheet) return defaultSlots;

    const data = sheet.getDataRange().getValues();
    const bookedCounts = {}; // { "09:00～10:00": 1, ... }

    for (let i = 1; i < data.length; i++) {
      const bDateVal = data[i][8];
      if (!bDateVal) continue;
      let bDateStr;
      try {
        let d = (bDateVal instanceof Date) ? bDateVal : new Date(String(bDateVal).replace(/-/g, '/'));
        bDateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
      } catch (e) {
        bDateStr = String(bDateVal);
      }
      
      if (data[i][2] === '予約確定' && data[i][7] === store && bDateStr === dateStr) {
        const timeSlot = data[i][9];
        bookedCounts[timeSlot] = (bookedCounts[timeSlot] || 0) + 1;
      }
    }

    // 4. 最大枠数に達していない枠だけを返す
    return defaultSlots.filter(slot => {
      const currentBooked = bookedCounts[slot] || 0;
      return currentBooked < storeSettings.maxSlots;
    });

  } catch (e) {
    return [];
  }
}

// ==========================================
// ユーザー API: 1週間カレンダー取得
// ==========================================

function getWeeklyAvailableSlots(store, startDateStr) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `weekly_slots_${store}_${startDateStr}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  ensureSheetsOnce();
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 全データを一括取得
    const settingsData = ss.getSheetByName(SHEET_SETTINGS).getDataRange().getValues();
    const holidaysData = ss.getSheetByName(SHEET_HOLIDAYS).getDataRange().getValues();
    const bookingsData = ss.getSheetByName(SHEET_BOOKINGS).getDataRange().getValues();

    // 店舗設定をMap化 (曜日 -> 設定)
    const storeSettingsMap = {};
    for (let i = 1; i < settingsData.length; i++) {
      if (settingsData[i][0] === store) {
        storeSettingsMap[settingsData[i][1]] = {
          active: settingsData[i][2] === true || settingsData[i][2] === 'true' || settingsData[i][2] === 'TRUE',
          start: settingsData[i][3],
          end: settingsData[i][4],
          breakStart: settingsData[i][5],
          breakEnd: settingsData[i][6],
          maxSlots: settingsData[i][7] || 1
        };
      }
    }

    // 休日をSet化 (YYYY/MM/DD)
    const holidaySet = new Set();
    for (let i = 1; i < holidaysData.length; i++) {
      if (holidaysData[i][0] === store && holidaysData[i][1]) {
        const hDate = (holidaysData[i][1] instanceof Date) ? Utilities.formatDate(holidaysData[i][1], 'Asia/Tokyo', 'yyyy/MM/dd') : String(holidaysData[i][1]);
        holidaySet.add(hDate);
      }
    }

    // 予約をMap化 (DateString -> TimeSlot -> Count)
    const bookingCounts = {};
    for (let i = 1; i < bookingsData.length; i++) {
      if (bookingsData[i][2] === '予約確定' && bookingsData[i][7] === store) {
        const bDateVal = bookingsData[i][8];
        if (!bDateVal) continue;
        let bDateStr;
        try {
          const bd = (bDateVal instanceof Date) ? bDateVal : new Date(String(bDateVal).replace(/-/g, '/'));
          bDateStr = Utilities.formatDate(bd, 'Asia/Tokyo', 'yyyy/MM/dd');
        } catch (e) { continue; }
        
        if (!bookingCounts[bDateStr]) bookingCounts[bDateStr] = {};
        const timeSlot = bookingsData[i][9];
        bookingCounts[bDateStr][timeSlot] = (bookingCounts[bDateStr][timeSlot] || 0) + 1;
      }
    }

    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const weeklySlots = [];
    const startDate = new Date(startDateStr.replace(/-/g, '/'));
    startDate.setHours(0, 0, 0, 0);

    const now = new Date();
    const todayStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd');
    const nowHour = now.getHours();

    for (let dOffset = 0; dOffset < 7; dOffset++) {
      const targetDate = new Date(startDate.getTime() + dOffset * 24 * 60 * 60 * 1000);
      const targetDateStr = Utilities.formatDate(targetDate, 'Asia/Tokyo', 'yyyy/MM/dd');
      let dayName = dayNames[targetDate.getDay()];
      
      // 祝日判定（キャッシュ付き）
      if (isNationalHolidayCached(targetDate)) {
        dayName = '祝';
      }

      const dayResult = {
        date: targetDateStr,
        dayName: dayName,
        slots: []
      };

      // 休館日または営業設定なし
      if (holidaySet.has(targetDateStr)) {
        weeklySlots.push(dayResult);
        continue;
      }

      let storeSettings = storeSettingsMap[dayName];
      if (!storeSettings) {
        storeSettings = {
          active: true, start: '09:00', end: '21:00',
          breakStart: '13:00', breakEnd: '14:00', maxSlots: 1
        };
      }

      if (!storeSettings.active) {
        weeklySlots.push(dayResult);
        continue;
      }

      // 時間枠生成
      const startStr = (storeSettings.start instanceof Date) ? Utilities.formatDate(storeSettings.start, 'Asia/Tokyo', 'HH:mm') : String(storeSettings.start);
      const endStr = (storeSettings.end instanceof Date) ? Utilities.formatDate(storeSettings.end, 'Asia/Tokyo', 'HH:mm') : String(storeSettings.end);
      let currentHour = parseInt(startStr.split(':')[0], 10);
      const endHour = parseInt(endStr.split(':')[0], 10);

      let bStartHour = -1, bEndHour = -1;
      if (storeSettings.breakStart) {
        const bsStr = (storeSettings.breakStart instanceof Date) ? Utilities.formatDate(storeSettings.breakStart, 'Asia/Tokyo', 'HH:mm') : String(storeSettings.breakStart);
        bStartHour = parseInt(bsStr.split(':')[0], 10);
      }
      if (storeSettings.breakEnd) {
        const beStr = (storeSettings.breakEnd instanceof Date) ? Utilities.formatDate(storeSettings.breakEnd, 'Asia/Tokyo', 'HH:mm') : String(storeSettings.breakEnd);
        bEndHour = parseInt(beStr.split(':')[0], 10);
      }

      const dailyBookings = bookingCounts[targetDateStr] || {};

      while (currentHour < endHour) {
        if (currentHour >= bStartHour && currentHour < bEndHour) {
          currentHour++;
          continue;
        }
        const slotTimeStr = `${String(currentHour).padStart(2, '0')}:00～${String(currentHour + 1).padStart(2, '0')}:00`;
        const booked = dailyBookings[slotTimeStr] || 0;
        
        const isPast = (targetDateStr < todayStr) || (targetDateStr === todayStr && currentHour <= nowHour);
        const maxSlots = storeSettings.maxSlots;

        dayResult.slots.push({
          time: slotTimeStr,
          max: maxSlots,
          booked: booked,
          available: !isPast && (booked < maxSlots),
          isPast: isPast
        });
        currentHour++;
      }
      weeklySlots.push(dayResult);
    }
    
    // 1分間キャッシュ（予約が入る可能性があるため短め）
    cache.put(cacheKey, JSON.stringify(weeklySlots), 60);
    return weeklySlots;
  } catch (e) {
    console.log('Error in getWeeklyAvailableSlots:', e.message);
    return [];
  }
}

// ==========================================
// 管理画面・設定管理 API
// ==========================================

function verifyAdminPin(pin) {
  ensureSheets();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SYSTEM_CONFIG);
  const data = sheet.getDataRange().getValues();
  let adminPin = '1234'; // デフォルト
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'ADMIN_PIN') {
      adminPin = String(data[i][1]);
      break;
    }
  }
  return pin === adminPin;
}

function getAppConfig() {
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get('app_config');
  if (cachedData) {
    return JSON.parse(cachedData);
  }

  ensureSheetsOnce();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // システム設定取得
  const configSheet = ss.getSheetByName(SHEET_SYSTEM_CONFIG);
  const configData = configSheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < configData.length; i++) {
    config[configData[i][0]] = configData[i][1];
  }

  // 店舗基本情報取得
  const storeSheet = ss.getSheetByName(SHEET_STORES);
  const storeDataRaw = storeSheet.getDataRange().getValues();
  const stores = [];
  const headers = storeDataRaw[0];
  for (let i = 1; i < storeDataRaw.length; i++) {
    const store = {};
    for (let j = 0; j < headers.length; j++) {
      store[headers[j]] = storeDataRaw[i][j];
    }
    stores.push(store);
  }

  const result = { config: config, stores: stores };
  cache.put('app_config', JSON.stringify(result), 600); // 10分間キャッシュ
  return result;
}

function saveStoreBasicInfo(storeList) {
  ensureSheetsOnce();
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_STORES);
    
    const headers = ['店舗名', '住所', '電話番号', 'カレンダーID', 'WebhookURL', 'メール持ち物', 'メール来店案内', '利用規約', 'プラン名', '通常価格', 'キャンペーン価格', 'キャンペーン備考'];
    const rows = storeList.map(s => [
      s.店舗名 || '',
      s.住所 || '',
      "'" + (s.電話番号 || ''),
      s.カレンダーID || '',
      s.WebhookURL || '',
      s.メール持ち物 || '',
      s.メール来店案内 || '',
      s.利用規約 || '',
      s.プラン名 || '',
      s.通常価格 || '',
      s.キャンペーン価格 || '',
      s.キャンペーン備考 || ''
    ]);
    
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    
    // キャッシュクリア
    CacheService.getScriptCache().remove('app_config');
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    lock.releaseLock();
  }
}

function saveSystemConfig(configObj) {
  ensureSheetsOnce();
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_SYSTEM_CONFIG);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // 既存データをコピー
    const updatedData = [headers];
    const existingKeys = new Set();
    
    // 既存の行を更新または保持
    for (let i = 1; i < data.length; i++) {
      const key = data[i][0];
      if (configObj.hasOwnProperty(key)) {
        updatedData.push([key, configObj[key], data[i][2] || '']);
        existingKeys.add(key);
      } else {
        updatedData.push(data[i]);
      }
    }
    
    // 新しいキーを追加
    for (let key in configObj) {
      if (!existingKeys.has(key)) {
        updatedData.push([key, configObj[key], '']);
      }
    }
    
    // 一括更新
    sheet.clear();
    sheet.getRange(1, 1, updatedData.length, updatedData[0].length).setValues(updatedData);
    
    CacheService.getScriptCache().remove('app_config');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    lock.releaseLock();
  }
}

function getStoreSettings(store) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `store_settings_${store}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  ensureSheetsOnce();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_SETTINGS);

  const data = sheet.getDataRange().getValues();
  const settings = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === store) {
      settings.push({
        day: data[i][1],
        active: data[i][2] === true || data[i][2] === 'true' || data[i][2] === 'TRUE',
        start: (data[i][3] instanceof Date) ? Utilities.formatDate(data[i][3], 'Asia/Tokyo', 'HH:mm') : String(data[i][3]),
        end: (data[i][4] instanceof Date) ? Utilities.formatDate(data[i][4], 'Asia/Tokyo', 'HH:mm') : String(data[i][4]),
        breakStart: data[i][5] ? ((data[i][5] instanceof Date) ? Utilities.formatDate(data[i][5], 'Asia/Tokyo', 'HH:mm') : String(data[i][5])) : '',
        breakEnd: data[i][6] ? ((data[i][6] instanceof Date) ? Utilities.formatDate(data[i][6], 'Asia/Tokyo', 'HH:mm') : String(data[i][6])) : '',
        maxSlots: data[i][7]
      });
    }
  }
  cache.put(cacheKey, JSON.stringify(settings), 600); // 10分間キャッシュ
  return settings;
}

/**
 * 管理画面用に店舗の設定と休日情報を一括で取得する（通信削減用）
 */
function getAdminStoreFullData(store) {
  return {
    settings: getStoreSettings(store),
    holidays: getHolidays(store)
  };
}

function saveStoreSettings(store, settingsList) {
  ensureSheetsOnce();
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_SETTINGS);
    const data = sheet.getDataRange().getValues();
    
    // 全データ（ヘッダー以外）を走査して、指定店舗の行を特定または追加
    const updatedData = [data[0]]; // ヘッダー
    const storeRows = data.filter((row, i) => i > 0 && row[0] === store);
    const otherRows = data.filter((row, i) => i > 0 && row[0] !== store);
    
    // 他の店舗のデータはそのまま保持
    otherRows.forEach(row => updatedData.push(row));
    
    // 指定店舗のデータを新設定で上書き
    settingsList.forEach(setting => {
      updatedData.push([
        store, setting.day, setting.active, setting.start, setting.end, setting.breakStart, setting.breakEnd, setting.maxSlots
      ]);
    });
    
    // シート全体を一括更新
    sheet.clear();
    sheet.getRange(1, 1, updatedData.length, updatedData[0].length).setValues(updatedData);
    
    // キャッシュクリア
    const cache = CacheService.getScriptCache();
    cache.remove(`weekly_slots_${store}`);
    cache.remove(`store_settings_${store}`);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 管理画面 API: 休日設定
// ==========================================

function getHolidays(store) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `holidays_${store}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  ensureSheetsOnce();
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_HOLIDAYS);

    const data = sheet.getDataRange().getValues();
    const holidays = [];

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === store) {
        const dateVal = data[i][1];
        const dateStr = (dateVal instanceof Date) ? Utilities.formatDate(dateVal, 'Asia/Tokyo', 'yyyy/MM/dd') : String(dateVal);
        holidays.push(dateStr);
      }
    }
    const result = [...new Set(holidays)].sort();
    cache.put(cacheKey, JSON.stringify(result), 600); // 10分間キャッシュ
    return result;
  } catch (error) {
    return [];
  }
}

function saveHoliday(store, dateStr) {
  ensureSheetsOnce();
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_HOLIDAYS);

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === store && data[i][1] === dateStr) {
        return { success: true };
      }
    }

    sheet.appendRow([store, dateStr]);
    
    // キャッシュクリア
    const cache = CacheService.getScriptCache();
    cache.remove(`holidays_${store}`);
    cache.remove(`weekly_slots_${store}`);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    lock.releaseLock();
  }
}

function removeHoliday(store, dateStr) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_HOLIDAYS);
    if (!sheet) return { success: false, error: 'シートがありません' };

    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      const hDateStr = (data[i][1] instanceof Date) ? Utilities.formatDate(data[i][1], 'Asia/Tokyo', 'yyyy/MM/dd') : String(data[i][1]);
      if (data[i][0] === store && hDateStr === dateStr) {
        sheet.deleteRow(i + 1);
      }
    }
    
    // キャッシュクリア
    const cache = CacheService.getScriptCache();
    cache.remove(`holidays_${store}`);
    cache.remove(`weekly_slots_${store}`);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 日本の祝日を判定する
 */
/**
 * 日本の祝日を判定する（キャッシュ付き）
 */
function isNationalHolidayCached(dateObj) {
  const dateStr = Utilities.formatDate(dateObj, 'Asia/Tokyo', 'yyyy/MM/dd');
  const cache = CacheService.getScriptCache();
  const cached = cache.get(`holiday_${dateStr}`);
  if (cached !== null) return cached === 'true';

  const isHoliday = isNationalHoliday(dateObj);
  cache.put(`holiday_${dateStr}`, String(isHoliday), 21600); // 6時間キャッシュ
  return isHoliday;
}

function isNationalHoliday(dateObj) {
  try {
    const calendarId = 'ja.japanese#holiday@group.v.calendar.google.com';
    const calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) return false;
    // getEventsForDayは重い場合があるので、期間指定で一括取得するなどの最適化も可能だが
    // ここでは1日分を取得
    const events = calendar.getEventsForDay(dateObj);
    return events.length > 0;
  } catch (e) {
    return false;
  }
}

// ==========================================
// 管理画面 API: カレンダー・予約管理
// ==========================================

function getReservationsForMonth(store, yearMonth) {
  ensureSheets();
  console.log('getReservationsForMonth called:', store, yearMonth);
  if (!store || !yearMonth) return [];
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_BOOKINGS);

    const data = sheet.getDataRange().getValues();
    const reservations = [];
    const [targetYear, targetMonth] = yearMonth.split('-').map(Number);
    
    console.log('Target YearMonth:', targetYear, targetMonth);

    for (let i = 1; i < data.length; i++) {
      // 店舗名とステータスの取得（空白除去）
      const sheetStore = String(data[i][7] || '').trim();
      const sheetStatus = String(data[i][2] || '').trim();
      
      // 店舗名の一致（部分一致でも許容するように調整）
      if (sheetStore.indexOf(store.trim()) !== -1 && sheetStatus === '予約確定') {
        let dateVal = data[i][8];
        if (!dateVal) continue;
        
        try {
          let d = (dateVal instanceof Date) ? dateVal : new Date(String(dateVal).replace(/-/g, '/'));
          if (isNaN(d.getTime())) continue;

          if (d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth) {
            const normalizedDateStr = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
            reservations.push({
              bookingId: String(data[i][0] || ''),
              timestamp: String(data[i][1] || ''),
              name: String(data[i][3] || ''),
              kana: String(data[i][4] || ''),
              phone: String(data[i][5] || ''),
              email: String(data[i][6] || ''),
              date: String(normalizedDateStr || ''),
              time: String(data[i][9] || '')
            });
          }
        } catch (e) {
          console.log('Date parse error row ' + i + ':', e.message);
          continue;
        }
      }
    }
    console.log('Found reservations:', reservations.length);
    return reservations || [];
  } catch (error) {
    console.log('Server Error:', error.message);
    return [];
  }
}

function adminCancelBooking(bookingId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_BOOKINGS);
    if (!sheet) return { success: false, error: '予約データが見つかりません' };

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === bookingId) {
        sheet.getRange(i + 1, 3).setValue('キャンセル');
        
        // カレンダーイベント削除
        const storeName = data[i][7];
        const eventId = data[i][10];
        if (eventId) {
          const storeInfo = getStoreBasicInfo(storeName);
          deleteCalendarEvent(eventId, storeInfo ? storeInfo.カレンダーID : 'primary');
        }
        
        return { success: true };
      }
    }
    return { success: false, error: '該当する予約が見つかりません' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

