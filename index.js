const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

// ✅ 測試 GET
app.get('/', (req, res) => {
  res.send('✅ Line webhook running!');
});

// ✅ 處理 LINE webhook 的 POST
app.post('/webhook', (req, res) => {
  console.log('📩 Received webhook:', JSON.stringify(req.body, null, 2));
  // 回應 LINE 平台 200 OK
  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
