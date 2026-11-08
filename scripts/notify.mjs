// TicketDesk notifier. Run on a schedule by GitHub Actions.
//   node scripts/notify.mjs morning     → morning brief (push + email)
//   node scripts/notify.mjs reminders   → "starts in about an hour" pushes
// Settings are read from GitHub Secrets, not from this file.

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, NTFY_TOPIC, RESEND_API_KEY, EMAIL_TO } = process.env;
const TIMEZONE = "Europe/Berlin";   // IANA time zone used for "today" and reminder times

// ---------- current date and time in TIMEZONE ----------
const now = new Date();
const today = now.toLocaleDateString("sv-SE", { timeZone: TIMEZONE });            // "2026-11-08"
const [hh, mm] = now.toLocaleTimeString("en-GB", { timeZone: TIMEZONE, hour12: false }).split(":").map(Number);
const nowMinutes = hh * 60 + mm;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const hhmm = t => (t ? t.slice(0, 5) : "");

// ---------- talking to Supabase ----------
async function supabase(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Supabase said ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ---------- sending ----------
async function pushToPhone(title, message) {
  if (!NTFY_TOPIC) return console.log("No NTFY_TOPIC set, skipping phone push");
  const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    body: message,
    headers: { Title: title },            // ntfy titles must be plain ASCII
  });
  if (!res.ok) throw new Error(`ntfy said ${res.status}`);
}

async function sendEmail(subject, text) {
  if (!RESEND_API_KEY || !EMAIL_TO) return console.log("No email settings, skipping email");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "TicketDesk <onboarding@resend.dev>", to: [EMAIL_TO], subject, text }),
  });
  if (!res.ok) throw new Error(`Resend said ${res.status}: ${await res.text()}`);
}

// ---------- the morning brief ----------
async function morning() {
  const tickets = await supabase("tickets?select=*&done=is.false");
  const projects = await supabase("projects?select=*");
  const projectName = id => (projects.find(p => p.id === id) || {}).name || "No project";
  const priority = t => t.importance * t.urgency;

  const todays = tickets
    .filter(t => t.planned_for === today)
    .sort((a, b) => ((a.start_time ? 0 : 1) - (b.start_time ? 0 : 1))
      || String(a.start_time || "").localeCompare(String(b.start_time || ""))
      || priority(b) - priority(a));
  const carried = tickets.filter(t => t.planned_for && t.planned_for < today);
  const backlog = tickets.filter(t => !t.planned_for);
  const oldest = Math.max(0, ...backlog.map(t => daysBetween(t.added_to_backlog || t.created_at.slice(0, 10), today)));
  const deadlines = projects
    .filter(p => p.deadline && daysBetween(today, p.deadline) >= 0 && daysBetween(today, p.deadline) <= 14)
    .map(p => `- ${p.name}: ${daysBetween(today, p.deadline)} days left (${p.deadline})`);

  const lines = [];
  lines.push(`TODAY (${todays.length})`);
  todays.forEach(t => lines.push(`- ${t.start_time ? hhmm(t.start_time) + " " : ""}${t.title} [${projectName(t.project_id)}]`));
  if (!todays.length) lines.push("- Nothing planned yet");
  if (carried.length) {
    lines.push("", `CARRIED OVER (${carried.length})`);
    carried.forEach(t => lines.push(`- ${t.title}: ${daysBetween(t.planned_for, today)} days late, slipped ${t.slips}x`));
  }
  if (deadlines.length) lines.push("", "DEADLINES, NEXT 14 DAYS", ...deadlines);
  lines.push("", `Backlog: ${backlog.length} tickets, oldest waiting ${oldest} days`);

  const text = lines.join("\n");
  console.log(text);
  await pushToPhone(`Your day: ${todays.length} tickets`, text);
  await sendEmail(`TicketDesk: ${todays.length} tickets today`, text);
}

// ---------- reminders about an hour before ----------
async function reminders() {
  const tickets = await supabase(`tickets?select=*&done=is.false&planned_for=eq.${today}&start_time=not.is.null`);
  for (const t of tickets) {
    const [h, m] = t.start_time.split(":").map(Number);
    const minutesLeft = h * 60 + m - nowMinutes;
    const stamp = `${t.planned_for} ${t.start_time}`;           // so it pings once per time slot
    if (minutesLeft > 0 && minutesLeft <= 75 && t.reminded !== stamp) {
      await pushToPhone(`Starts at ${hhmm(t.start_time)}`, `${t.title}\n${t.description || ""}`.trim());
      await supabase(`tickets?id=eq.${t.id}`, { method: "PATCH", body: JSON.stringify({ reminded: stamp }) });
      console.log("Reminded:", t.title);
    }
  }
}

// ---------- run ----------
const mode = process.argv[2];
if (mode === "morning") await morning();
else if (mode === "reminders") await reminders();
else throw new Error('Say "morning" or "reminders"');
