// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

// Setup Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // make sure your .env uses SUPABASE_SERVICE_KEY
);

const PORT = process.env.PORT || 4000;

// Setup Nodemailer with Gmail OAuth2
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    type: "OAuth2",
    user: process.env.MAIL_USER,
    clientId: process.env.MAIL_CLIENT_ID,
    clientSecret: process.env.MAIL_CLIENT_SECRET,
    refreshToken: process.env.MAIL_REFRESH_TOKEN,
  },
});

// Format GitHub events into summary
function formatEventsSummary(events, limit = 5) {
  const items = events.slice(0, limit).map((e) => {
    const time = new Date(e.created_at).toLocaleString();
    const actor = e.actor?.login || e.actor?.display_login || "unknown";
    const repo = e.repo?.name || e.repository?.full_name || "unknown";
    const type = e.type || "Event";
    return `• [${type}] ${repo} by ${actor} (${time})`;
  });
  return items.join("\n");
}

// Fetch GitHub events
async function fetchGitHubEvents() {
  const url = "https://api.github.com/events";
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  }
  const res = await axios.get(url, { headers });
  return res.data;
}

// Store a subscriber (called by frontend)
app.post("/api/signup", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const { error } = await supabase.from("subscribers").insert([{ email }]);

    if (error) {
      if (error.code === "23505" || /duplicate/i.test(error.message)) {
        return res.json({ ok: true, message: "Email already saved" });
      }
      throw error;
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Fetch GitHub events and email all subscribers
app.post("/api/send-updates", async (req, res) => {
  try {
    const key = req.headers["x-api-key"] || req.query.key;
    if (!key || key !== process.env.BACKEND_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const events = await fetchGitHubEvents();
    const summaryText = formatEventsSummary(events, 5);
    const htmlBody = `<p>Here are the latest GitHub public events (top 5):</p><pre>${summaryText}</pre>`;

    const { data: subscribers, error } = await supabase
      .from("subscribers")
      .select("email");
    if (error) throw error;
    if (!subscribers.length) {
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    for (const row of subscribers) {
      const mailOptions = {
        from: process.env.MAIL_USER,
        to: row.email,
        subject: "Your GitHub timeline update",
        text: `Latest events:\n\n${summaryText}`,
        html: htmlBody,
      };

      try {
        await transporter.sendMail(mailOptions);
        sent++;
      } catch (e) {
        console.error("Send failed for", row.email, e.message || e);
      }
    }

    return res.json({ ok: true, sent });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
