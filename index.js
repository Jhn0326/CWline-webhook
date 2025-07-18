const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const line = require('@line/bot-sdk');
const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config();

// 🩹 修正 LINE Token 多餘空格
process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN.trim();

const app = express();
app.use(bodyParser.json());

const port = process.env.PORT || 3000;

// 📝 Render: 還原 credentials.json（只給 Google Sheets 用）
if (process.env.GOOGLE_CREDENTIALS && !fs.existsSync('credentials.json')) {
  console.log('📦 還原 credentials.json...');
  fs.writeFileSync(
    'credentials.json',
    Buffer.from(process.env.GOOGLE_CREDENTIALS, 'base64')
  );
}

// Google Sheets 認證
const sheetsAuth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

// LINE SDK 設定
const lineClient = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

// 使用者對應表
const userMap = {
  'Vincent祖頤': '阿祖',
  '孫傳翔 棋勝採購': '小孫',
  '曾俊逸–棋勝汽車': '俊逸',
  '棋勝CW採購 – 林子勛（小勛）': '子勛',
  '棋勝汽車–李怡誼Eve💖': '怡諠',
  '蔣宜鋒Chiang': '阿蔣',
  '蘇永健Gavin🦅': '阿健',
  '謝庠澤jack': 'Jack',
  '高弘杰': '小高',
  '郭頌鑫': '郭頌鑫',
  'JHN_WU': 'JHN_WU',
};

// 案件來源對應邏輯
function map案件來源(level, text) {
  const carBrands = ['Benz', 'BMW', 'Toyota', 'Lexus', 'Audi', 'Volkswagen', 'Ford', 'Honda', 'Nissan', 'Mazda'];
  const hasCarBrand = carBrands.some(brand => text.includes(brand));

  if (level.includes('買')) {
    return '同業';
  } else if (level.includes('中和BMW銷售經理') && hasCarBrand) {
    return '新車業務';
  } else if (level.includes('直客')) {
    return '直客';
  } else if (level.includes('貸款')) {
    return '貸款';
  } else if (level.includes('租賃')) {
    return '租賃';
  } else {
    return level; // 保留原文字
  }
}

// 取得使用者名稱
async function getDisplayName(source) {
  try {
    if (source.type === 'user') {
      const profile = await lineClient.getProfile(source.userId);
      return profile.displayName;
    } else if (source.type === 'group') {
      const profile = await lineClient.getGroupMemberProfile(source.groupId, source.userId);
      return profile.displayName;
    } else if (source.type === 'room') {
      const profile = await lineClient.getRoomMemberProfile(source.roomId, source.userId);
      return profile.displayName;
    }
  } catch (err) {
    console.error('⚠️ 無法取得使用者名稱:', err.message);
    return '未知';
  }
}

// 解析報車訊息
async function parseCarReport(text, user) {
  const regexes = {
    年份: /2\.\s*年份[:：]?\s*(\d{4}(\.\d{1,2})?)/i,
    顏色: /3\.\s*顏色[:：]?\s*([\u4e00-\u9fa5A-Za-z\/]+)/i,
    里程: /4\.\s*里程[:：]?\s*([\d\.]+萬?)/i,
    書價: /5\.\s*新車[:：]?\s*([\d\.]+)/i,
    權威: /6\.\s*權威[:：]?\s*([\d\.]+)/i,
    案件來源: /7\.\s*業務等級[:：]?\s*(.+)/i,
  };

  let result = {
    負責業務: user,
    案件狀態: '',
    案件來源: '',
    年份: '',
    廠牌: '',
    車型: '',
    顏色: '',
    里程: '',
    書價: '',
    核價: '',
    出價: '',
  };

  // 自動解析
  result.年份 = text.match(regexes.年份)?.[1] || '';
  result.顏色 = text.match(regexes.顏色)?.[1] || '';
  result.里程 = text.match(regexes.里程)?.[1] || '';
  result.書價 = text.match(regexes.書價)?.[1] || '';

  // 抓案件來源
  const level = text.match(regexes.案件來源)?.[1] || '';
  result.案件來源 = map案件來源(level, text);

  // 嘗試抓第一行的車名
  const firstLine = text.split('\n')[0];
  const carParts = firstLine.split(/\s+/);
  result.廠牌 = carParts[0] || '';
  result.車型 = carParts.slice(1).join(' ') || '';

  return Object.values(result);
}

app.post('/webhook', async (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text.trim();
      const displayName = userMap[await getDisplayName(event.source)] || '未知';

      console.log(`📥 收到訊息: "${text}" 來自: ${displayName}`);

      // 👤 郭頌鑫更新「核價」
      if (displayName === '郭頌鑫') {
        const price = parseFloat(text);
        if (!isNaN(price)) {
          const lastRow = await getLastRow();
          await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `${process.env.SHEET_NAME}!K${lastRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[price]] }
          });
          console.log(`✅ 更新上一筆核價欄位為: ${price}`);
        } else {
          console.log('⚠️ 郭頌鑫傳送的不是純數字，略過更新核價');
        }
        continue;
      }

      // 其他業務 → 程式解析 + 寫入 Sheets
      const parsedRow = await parseCarReport(text, displayName);
      const today = new Date().toISOString().split('T')[0];
      const row = [today, ...parsedRow];

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${process.env.SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [row] }
      });
      console.log('✅ 新增一筆資料至 Google Sheets:', row);
    }
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('✅ Line webhook running!');
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

async function getLastRow() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${process.env.SHEET_NAME}!A:A`
  });
  return res.data.values.length + 1;
}
