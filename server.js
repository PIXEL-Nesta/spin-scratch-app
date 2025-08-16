// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // change in .env for production

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

let store = { users: {}, otps: {}, sessions: {}, withdrawals: [], events: [] };

async function loadStore() {
  try {
    if (await fs.pathExists(DATA_FILE)) {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      store = JSON.parse(raw);
    } else { await saveStore(); }
  } catch (e) { console.error('Failed to load store:', e); }
}
async function saveStore() { await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf8'); }
loadStore();

function genOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function normalizePhone(p) {
  if (!p) return '';
  let s = p.replace(/\s+/g, '');
  if (!s.startsWith('+')) { s = (process.env.DEFAULT_COUNTRY_CODE || '+91') + s.replace(/^0+/, ''); }
  return s;
}
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ ok: false, message: 'Missing token' });
  const token = header.replace('Bearer ', '');
  const phone = store.sessions[token];
  if (!phone) return res.status(401).json({ ok: false, message: 'Invalid token' });
  req.userPhone = phone; next();
}

// Fake OTP sender
app.post('/api/send-otp', async (req, res) => {
  const { username, phone, email } = req.body || {};
  if (!username || !phone || !email) return res.status(400).json({ ok: false, message: 'username, phone, email required' });
  const phoneNorm = normalizePhone(phone);
  const otp = genOTP(); const expiresAt = Date.now() + 5 * 60 * 1000;
  store.otps[phoneNorm] = { otp, expiresAt, username, email }; await saveStore();
  console.log(`[MOCK OTP] for ${phoneNorm} => ${otp}`);
  res.json({ ok: true, mode: 'mock', otp, message: 'OTP generated (mock). Visible on page & server console.' });
});

app.post('/api/verify-otp', async (req, res) => {
  const { phone, otp } = req.body || {};
  if (!phone || !otp) return res.status(400).json({ ok: false, message: 'phone & otp required' });
  const phoneNorm = normalizePhone(phone);
  const record = store.otps[phoneNorm];
  if (!record) return res.status(400).json({ ok: false, message: 'No OTP found' });
  if (Date.now() > record.expiresAt) {
    delete store.otps[phoneNorm]; await saveStore();
    return res.status(400).json({ ok: false, message: 'OTP expired' });
  }
  if (record.otp !== otp) return res.status(400).json({ ok: false, message: 'Invalid OTP' });

  if (!store.users[phoneNorm]) {
    store.users[phoneNorm] = {
      id: uuidv4(), username: record.username, email: record.email,
      phone: phoneNorm, balance: 0, createdAt: new Date().toISOString()
    };
  }
  const token = uuidv4(); store.sessions[token] = phoneNorm;
  delete store.otps[phoneNorm]; await saveStore();
  res.json({ ok: true, token, user: store.users[phoneNorm] });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const u = store.users[req.userPhone]; if (!u) return res.status(404).json({ ok: false });
  res.json({ ok: true, user: u });
});

app.post('/api/play/spin', authMiddleware, async (req, res) => {
  const segments = [0,5,10,20,50,100,0,25];
  const prize = segments[Math.floor(Math.random() * segments.length)];
  const user = store.users[req.userPhone];
  user.balance = (user.balance || 0) + prize;
  store.events.push({ id: uuidv4(), userPhone: req.userPhone, type: 'spin', prize, ts: new Date().toISOString() });
  await saveStore();
  res.json({ ok: true, prize, balance: user.balance });
});

app.post('/api/play/scratch', authMiddleware, async (req, res) => {
  const prizes = [0,5,10,20,50,100,0,25];
  const prize = prizes[Math.floor(Math.random() * prizes.length)];
  const user = store.users[req.userPhone];
  user.balance = (user.balance || 0) + prize;
  store.events.push({ id: uuidv4(), userPhone: req.userPhone, type: 'scratch', prize, ts: new Date().toISOString() });
  await saveStore();
  res.json({ ok: true, prize, balance: user.balance });
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
  const { amount, method } = req.body || {};
  if (!amount || !method) return res.status(400).json({ ok: false, message: 'amount and method required' });
  const user = store.users[req.userPhone];
  if (user.balance < amount) return res.status(400).json({ ok: false, message: 'Insufficient balance' });
  const withdraw = { id: uuidv4(), userPhone: req.userPhone, amount, method, status: 'pending', createdAt: new Date().toISOString() };
  store.withdrawals.push(withdraw); await saveStore();
  res.json({ ok: true, withdraw });
});

// Admin
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === (process.env.ADMIN_PASSWORD || 'admin123')) {
    return res.json({ ok: true, token: (process.env.ADMIN_TOKEN || 'admintoken123') });
  }
  res.status(401).json({ ok: false, message: 'Bad password' });
});

app.get('/api/admin/users', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== (process.env.ADMIN_TOKEN || 'admintoken123')) return res.status(401).json({ ok: false });
  res.json({ ok: true, users: Object.values(store.users) });
});

app.get('/api/admin/withdrawals', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== (process.env.ADMIN_TOKEN || 'admintoken123')) return res.status(401).json({ ok: false });
  res.json({ ok: true, withdrawals: store.withdrawals });
});

app.post('/api/admin/withdrawals/:id/process', async (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== (process.env.ADMIN_TOKEN || 'admintoken123')) return res.status(401).json({ ok: false });
  let body=''; req.on('data', c=> body+=c); req.on('end', async ()=>{
    const { action } = JSON.parse(body || '{}');
    const w = store.withdrawals.find(x => x.id === req.params.id);
    if (!w) return res.status(404).json({ ok: false });
    if (w.status !== 'pending') return res.status(400).json({ ok: false, message: 'Already processed' });
    if (action === 'approve') {
      const user = store.users[w.userPhone];
      if (!user || user.balance < w.amount) return res.status(400).json({ ok: false, message: 'Insufficient user balance' });
      user.balance -= w.amount;
      w.status = 'paid'; w.processedAt = new Date().toISOString();
    } else {
      w.status = 'rejected'; w.processedAt = new Date().toISOString();
    }
    await saveStore(); res.json({ ok: true, w });
  });
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Admin password:', ADMIN_PASSWORD);
});
