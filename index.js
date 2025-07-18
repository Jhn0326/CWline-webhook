const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = 'BOT';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

async function gptParse(text) {
  const prompt = `
你是一個專門處理中古車採購報告的 AI。請將以下報車訊息整理成 JSON 陣列格式。

欄位順序固定：
["日期","負責業務","案件狀態","案件來源","年份","品牌","車型","顏色","里程","書價","核價","出價"]

規則：
- 日期：今天日期（YYYY/MM/DD）
- 負責業務：從訊息內對應名稱判斷
- 案件狀態：固定為「追蹤中」
- 案件來源：從「業務等級」關鍵字判斷
- 顏色：外觀色/內裝色格式
- 里程：轉換成萬公里（例：37000 ➝ 3.7）
- 書價：權威價格數字
- 核價、出價：留空
- 多台車分開多筆資料
- 不要多餘文字，只回純 JSON

範例輸入：
CX-9 2WD-R
2.年份 : 2022.11
3.顏色 : 白
4.里程：3.7萬
5.新車價：169.9
6.權威：23年99
7.業務等級：格上第一次
8.市場
23年 灰色 跑2.6萬 開99.9萬

範例輸出：
[
  ["2025/07/19","阿蔣","追蹤中","新車業務","2022","Mazda","CX-9 2WD-R","白/黑","3.7","99","",""]
]

實際訊息：
${text}
`;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const jsonText = response.data.choices[0].message.content.trim();
    return JSON.parse(jsonText);
  } catch (err) {
    console.error('❌ GPT解析失敗:', err.response?.data || err.message);
    return [];
  }
}

app.post('/webhook', async (req, res) => {
  console.log('📩 Received webhook:', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);

  const events = req.body.events || [];
  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const text = event.message.text.trim();
    const displayName = event.source.userId;

    // 郭頌鑫補核價
    if (displayName === 'U郭頌鑫的UserID') {
      const price = parseFloat(text);
      if (!isNaN(price)) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!K2`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [[price]] }
        });
        console.log(`✅ 更新核價欄位為: ${price}`);
      } else {
        console.log('🚫 郭頌鑫訊息非數字，忽略');
      }
      continue;
    }

    // GPT 解析報車訊息
    const rows = await gptParse(text);
    if (rows.length === 0) {
      console.log('🚫 GPT 無解析結果，略過');
      continue;
    }

    // 寫入 Google Sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: SHEET_NAME,
      valueInputOption: 'USER_ENTERED',
      resource: { values: rows }
    });
    console.log('✅ 已寫入 Google Sheet:', rows);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
