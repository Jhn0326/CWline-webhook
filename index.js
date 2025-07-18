const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const line = require('@line/bot-sdk');
const fetch = require('node-fetch'); // 如果沒有請先 npm install node-fetch
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const port = process.env.PORT || 3000;

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME;

// Google Sheets 認證
const sheetsAuth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

// Gemini 認證
const geminiAuth = new GoogleAuth({
  keyFile: 'cwlinebot-71e08a50a13e.json',
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});
const geminiClient = geminiAuth.getClient();

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
  '郭頌鑫': '核價專員',
  'JHN_WU': 'JHN_WU',
};

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

app.post('/webhook', async (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text;
      const displayName = userMap[await getDisplayName(event.source)] || '未知';

      console.log(`📥 收到訊息: "${text}" 來自: ${displayName}`);

      if (displayName === '核價專員') {
        const price = parseFloat(text);
        if (!isNaN(price)) {
          const lastRow = await getLastRow();
          await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!K${lastRow}`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [[price]] }
          });
          console.log(`✅ 更新核價欄位: ${price}`);
        }
        continue;
      }

      const prompt = `請將以下報車訊息解析成表格資料，欄位順序為：負責業務、案件狀態、案件來源、年份、品牌、車型、顏色、里程、書價、核價、出價。\n\n訊息：${text}`;

      try {
        const accessToken = await (await geminiClient).getAccessToken();
        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken.token}`,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
          }
        );

        const data = await response.json();
        const parsedData = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const row = parsedData.split('\t');

        // 附加來源資訊：群組/私聊
        const sourceInfo = event.source.type === 'group'
          ? `群組:${event.source.groupId}`
          : '私聊';
        row.push(sourceInfo);

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A1`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [row] }
        });
        console.log('✅ 已寫入 Google Sheet:', row);
      } catch (err) {
        console.error('❌ Gemini API 錯誤:', err.response?.data || err.message);
      }
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
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:A`
  });
  return res.data.values.length + 1;
}
