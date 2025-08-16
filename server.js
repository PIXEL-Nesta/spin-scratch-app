
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// ------------------- Fake DB -------------------
let users = [];
let withdrawals = [];
let sessions = {}; // phone -> otp

// ------------------- Admin Credentials -------------------
const ADMIN_USER = "sunnysolanki17779@gmail.com";        // 👈 change username here
const ADMIN_PASS = "sunnysolanki17779@gmail.com";        // 👈 change password here
const ADMIN_TOKEN = "super-secret-admin-token"; // fixed admin token

// ------------------- OTP Login -------------------
app.post("/api/send-otp", (req, res) => {
  const { phone } = req.body;
  const otp = Math.floor(1000 + Math.random() * 9000);
  sessions[phone] = otp;

  console.log(`OTP for ${phone}: ${otp}`);
  // 🚨 Instead of SMS, OTP will be shown on frontend alert
  res.json({ ok: true, otp });
});

app.post("/api/verify-otp", (req, res) => {
  const { phone, otp, username, email } = req.body;
  if (sessions[phone] && sessions[phone] == otp) {
    let user = users.find(u => u.phone === phone);
    if (!user) {
      user = { username, phone, email, balance: 100 };
      users.push(user);
    }
    return res.json({ ok: true });
  }
  res.json({ ok: false, message: "Invalid OTP" });
});

// ------------------- Withdraw -------------------
app.post("/api/withdraw", (req, res) => {
  const { phone, amount, method } = req.body;
  const user = users.find(u => u.phone === phone);
  if (!user) return res.json({ ok: false, message: "User not found" });
  if (user.balance < amount) return res.json({ ok: false, message: "Insufficient balance" });

  user.balance -= amount;
  withdrawals.push({
    id: withdrawals.length + 1,
    userPhone: phone,
    amount,
    method,
    status: "pending",
  });
  res.json({ ok: true });
});

// ------------------- Admin Login -------------------
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ ok: true, token: ADMIN_TOKEN });
  }
  res.json({ ok: false, message: "Invalid credentials" });
});

// Middleware for admin auth
function checkAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (token === ADMIN_TOKEN) return next();
  return res.status(403).json({ ok: false, message: "Unauthorized" });
}

// ------------------- Admin APIs -------------------
app.get("/api/admin/users", checkAdmin, (req, res) => {
  res.json({ users });
});

app.get("/api/admin/withdrawals", checkAdmin, (req, res) => {
  res.json({ withdrawals });
});

app.post("/api/admin/withdrawals/:id/process", checkAdmin, (req, res) => {
  const { id } = req.params;
  const { action } = req.body;
  const wd = withdrawals.find(w => w.id == id);
  if (!wd) return res.json({ ok: false, message: "Not found" });
  if (wd.status !== "pending") return res.json({ ok: false, message: "Already processed" });

  if (action === "approve") wd.status = "approved";
  else if (action === "reject") {
    wd.status = "rejected";
    const user = users.find(u => u.phone === wd.userPhone);
    if (user) user.balance += wd.amount; // refund
  }
  res.json({ ok: true });
});

// ------------------- Routes -------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html")); // main site
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public/dashboard.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin.html"));
});

// ------------------- Start -------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
