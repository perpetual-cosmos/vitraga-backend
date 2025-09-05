// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const app = express();
app.use(cors());
app.use(express.json());

// Debug logs
console.log("Supabase URL exists:", !!process.env.SUPABASE_URL);
console.log("Supabase Key exists:", !!process.env.SUPABASE_SERVICE_KEY);

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Resend setup
const resend = new Resend(process.env.RESEND_API_KEY);

const PORT = process.env.PORT || 4000;

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

    console.log("✅ Authorized request received");

    const events = await fetchGitHubEvents();
    console.log("✅ GitHub events fetched:", events.length);

    const summaryText = formatEventsSummary(events, 5);
    console.log("✅ Summary generated:\n", summaryText);

    const { data: subscribers, error } = await supabase
      .from("subscribers")
      .select("email");
    if (error) throw error;
    console.log("✅ Subscribers fetched:", subscribers);

    if (!subscribers.length) {
      console.log("⚠️ No subscribers found.");
      return res.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    for (const row of subscribers) {
      try {
        console.log("📧 Sending to:", row.email);
        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: row.email,
          subject: "Your GitHub timeline update",
          text: `Latest events:\n\n${summaryText}`,
          html: `<p>Here are the latest GitHub public events:</p><pre>${summaryText}</pre>`,
        });
        sent++;
        console.log("✅ Sent to:", row.email);
      } catch (e) {
        console.error("❌ Send failed for", row.email, e.message || e);
      }
    }

    return res.json({ ok: true, sent });
  } catch (err) {
    console.error("❌ Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Public endpoint to fetch GitHub events for frontend
app.get("/api/events", async (req, res) => {
  try {
    const events = await fetchGitHubEvents();
    const summaryText = formatEventsSummary(events, 5);
    return res.json({ ok: true, summary: summaryText, raw: events.slice(0, 5) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch GitHub events" });
  }
});

// Trigger send updates for ONE email (for demo)
app.post("/api/send-to-me", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });

    const events = await fetchGitHubEvents();
    const summaryText = formatEventsSummary(events, 5);

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: "Your GitHub timeline update",
      text: `Latest events:\n\n${summaryText}`,
      html: `<p>Here are the latest GitHub events:</p><pre>${summaryText}</pre>`,
    });

    return res.json({ ok: true, message: "Email sent successfully!" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to send email" });
  }
});



app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));