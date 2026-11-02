// ============================================================
// EMINENT INTELLIGENCE — BACKEND SERVER
// Book appointments → Google Calendar → Email + Payment Link
// ============================================================

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ── GOOGLE CALENDAR ──────────────────────────────────────
let calendar;
try {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar']
  });
  calendar = google.calendar({ version: 'v3', auth });
} catch(e) {
  console.log('Google Calendar not configured:', e.message);
}

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

// ── SERVICE PRICES ────────────────────────────────────────
const SERVICE_PAYPAL = {
  'DOT Urine Drug Test': { price: 95, link: 'https://www.paypal.com/ncp/payment/HA783VZGPWNKE' },
  'Non-DOT Urine Drug Test': { price: 85, link: 'https://www.paypal.com/ncp/payment/PFEHTDQ82ZL34' },
  'Hair Drug Test': { price: 325, link: 'https://www.paypal.com/ncp/payment/AYURB2FJ8C584' },
  'Nail Drug Test': { price: 325, link: 'https://www.paypal.com/ncp/payment/MTF4SZ9ZND37G' },
  'Urine Alcohol Test': { price: 125, link: 'https://www.paypal.com/ncp/payment/CZV4GHUBDMGPS' },
  'Hair Alcohol Test': { price: 325, link: 'https://www.paypal.com/ncp/payment/T2RJHGJTUE2JC' },
  'Nail Alcohol Test': { price: 325, link: 'https://www.paypal.com/ncp/payment/6K4W4S2PGD5EU' },
  'Mobile Phlebotomy': { price: 95, link: 'https://www.paypal.com/ncp/payment/PSYQXXYNBA4PJ' },
  'Paramedical Exam': { price: 95, link: 'https://www.paypal.com/ncp/payment/JXTR7NFEUVQFS' },
  'Diagnostic Collection': { price: 85, link: 'https://www.paypal.com/ncp/payment/E5N63U5AC26KE' },
  'CNA Skills Training': { price: 75, link: 'https://www.paypal.com/ncp/payment/DXDUKABV3EUCJ' },
  'HSI CPR Certification': { price: 50, link: '' },
  'After-Hours Fee': { price: 50, link: 'https://www.paypal.com/ncp/payment/4KDWM5RMTZ4PY' },
};

// ── SEND EMAIL (Resend) ───────────────────────────────────
async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { error: 'No email key' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Eminent Health Services <info@eminenthealthservice.org>',
      to: [to],
      subject,
      html
    })
  });
  return await r.json();
}

// ── SEND SMS (Twilio) ─────────────────────────────────────
async function sendSMS(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER || '+18883071308';
  if (!sid || !auth) return { error: 'Twilio not configured' };
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString()
  });
  return await r.json();
}

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'EMINENT INTELLIGENCE ONLINE',
    calendar: !!calendar,
    email: !!process.env.RESEND_API_KEY,
    sms: !!process.env.TWILIO_ACCOUNT_SID
  });
});

// ── CHECK AVAILABILITY ────────────────────────────────────
app.get('/api/availability', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.json({ error: 'Date required' });

  if (!calendar) {
    // Return default slots if no calendar configured
    return res.json({
      date,
      available: ['8:00 AM','9:15 AM','10:30 AM','11:45 AM','1:00 PM','2:15 PM','3:30 PM','4:45 PM']
    });
  }

  try {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(`${date}T23:59:59`);
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        items: [{ id: CALENDAR_ID }]
      }
    });

    const busy = fb.data.calendars[CALENDAR_ID]?.busy || [];
    const allSlots = ['8:00','9:15','10:30','11:45','13:00','14:15','15:30','16:45'];

    const available = allSlots.filter(slot => {
      const [h, m] = slot.split(':');
      const slotStart = new Date(`${date}T${slot}:00`);
      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
      return !busy.some(b => {
        const bs = new Date(b.start);
        const be = new Date(b.end);
        return slotStart < be && slotEnd > bs;
      });
    }).map(s => {
      const [h, m] = s.split(':');
      const hr = parseInt(h);
      return `${hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
    });

    res.json({ date, available });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ── BOOK APPOINTMENT ──────────────────────────────────────
app.post('/api/book', async (req, res) => {
  const { name, phone, email, service, date, time, address, notes, employer } = req.body;

  if (!name || !service || !date || !time) {
    return res.status(400).json({ error: 'name, service, date, time required' });
  }

  const result = { name, service, date, time };

  // 1. Book to Google Calendar
  if (calendar) {
    try {
      const dateTimeStr = `${date}T${convertTo24h(time)}:00`;
      const endDateTimeStr = `${date}T${addHour(convertTo24h(time))}:00`;

      const event = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary: `${service} — ${name}`,
          description: [
            `Client: ${name}`,
            `Phone: ${phone || 'N/A'}`,
            `Email: ${email || 'N/A'}`,
            `Address: ${address || 'TBD'}`,
            employer ? `Employer: ${employer}` : '',
            notes ? `Notes: ${notes}` : ''
          ].filter(Boolean).join('\n'),
          start: { dateTime: dateTimeStr, timeZone: 'America/Chicago' },
          end: { dateTime: endDateTimeStr, timeZone: 'America/Chicago' },
          reminders: {
            useDefault: false,
            overrides: [
              { method: 'email', minutes: 1440 },
              { method: 'popup', minutes: 60 }
            ]
          }
        }
      });
      result.calendar_event_id = event.data.id;
      result.calendar_link = event.data.htmlLink;
    } catch (e) {
      result.calendar_error = e.message;
    }
  }

  // 2. Get payment link for service
  const serviceKey = Object.keys(SERVICE_PAYPAL).find(k => service.toLowerCase().includes(k.toLowerCase()));
  const paypalInfo = serviceKey ? SERVICE_PAYPAL[serviceKey] : null;
  const paymentLink = paypalInfo?.link || process.env.STRIPE_PAYMENT_LINK || '';
  const price = paypalInfo?.price || 0;
  result.payment_link = paymentLink;
  result.price = price;

  // 3. Send confirmation email to client
  if (email) {
    const paymentSection = paymentLink
      ? `<div style="background:#CC0000;padding:20px;text-align:center;margin:20px 0;border-radius:4px"><a href="${paymentLink}" style="color:#fff;font-size:16px;font-weight:bold;text-decoration:none">&#9654; Pay Now — $${price}</a><p style="color:#fff;font-size:11px;margin:8px 0 0">Payment required to confirm your appointment</p></div>`
      : '';

    const emailHtml = `
<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;background:#fff">
  <div style="background:#0A0A0A;padding:24px;text-align:center">
    <div style="color:#CC0000;font-size:22px;font-weight:bold;letter-spacing:2px">EMINENT HEALTH SERVICES</div>
    <div style="color:#888;font-size:10px;letter-spacing:3px;margin-top:4px">APPOINTMENT CONFIRMATION</div>
  </div>
  <div style="padding:30px">
    <p style="font-size:16px;color:#333">Dear <strong>${name}</strong>,</p>
    <p style="color:#555;line-height:1.6">Your appointment request has been received. Please complete payment below to confirm your booking.</p>
    <div style="background:#f9f9f9;border-left:4px solid #CC0000;padding:16px;margin:20px 0">
      <div style="font-size:13px;color:#333;line-height:1.8">
        <strong>Service:</strong> ${service}<br>
        <strong>Date:</strong> ${formatDate(date)}<br>
        <strong>Time:</strong> ${time}<br>
        ${address ? `<strong>Location:</strong> ${address}<br>` : '<strong>Location:</strong> Mobile — We Come to You<br>'}
        ${price ? `<strong>Amount Due:</strong> $${price}` : ''}
      </div>
    </div>
    ${paymentSection}
    <div style="background:#fff8f0;border:1px solid #ffd;padding:14px;font-size:12px;color:#666;margin:16px 0">
      <strong>What to expect:</strong> Our team will arrive at your location at the scheduled time. Please have your ID ready. For drug testing, avoid excessive hydration. For phlebotomy, drink water and eat beforehand unless fasting is required.
    </div>
    <p style="font-size:12px;color:#999">Questions? Call us at <strong>888-511-1134</strong> or email <strong>info@eminenthealthservice.org</strong></p>
  </div>
  <div style="background:#0A0A0A;padding:16px;text-align:center">
    <div style="color:#CC0000;font-size:10px;letter-spacing:2px">EMINENT HEALTH SERVICES</div>
    <div style="color:#555;font-size:9px;margin-top:4px">888-511-1134 &bull; eminenthealthservice.org</div>
  </div>
</div>`;

    const emailResult = await sendEmail(email, `Appointment Confirmation — ${service} on ${formatDate(date)}`, emailHtml);
    result.email_sent = !emailResult.error;
  }

  // 4. Send SMS confirmation
  if (phone) {
    const smsBody = paymentLink
      ? `Eminent Health Services: Hi ${name.split(' ')[0]}! Your ${service} is set for ${formatDate(date)} at ${time}. Pay here to confirm: ${paymentLink} — Questions? 888-511-1134`
      : `Eminent Health Services: Hi ${name.split(' ')[0]}! Your ${service} is set for ${formatDate(date)} at ${time}. We will come to you. Questions? 888-511-1134`;

    const smsResult = await sendSMS(phone, smsBody);
    result.sms_sent = !smsResult.error_code;
  }

  result.success = true;
  result.message = `Appointment booked for ${name} — ${service} on ${formatDate(date)} at ${time}`;
  res.json(result);
});

// ── TWILIO INCOMING CALL (IMANI) ──────────────────────────
app.post('/api/twilio/voice', async (req, res) => {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Thank you for calling Eminent Health Services and Eminent Intelligence. My name is Imani. Please hold while I connect you.</Say>
  <Redirect>https://api.vapi.ai/twilio/voice</Redirect>
</Response>`;
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
});

// ── HELPERS ───────────────────────────────────────────────
function convertTo24h(time12) {
  const [time, meridiem] = time12.split(' ');
  let [hours, minutes] = time.split(':');
  hours = parseInt(hours);
  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2,'0')}:${minutes || '00'}`;
}

function addHour(time24) {
  const [h, m] = time24.split(':');
  return `${String(parseInt(h) + 1).padStart(2,'0')}:${m}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ── AGENT SYSTEM (registry, router, Approval Queue, UI pages) ──
require('./routes/agents')(app, express);

app.listen(PORT, () => {
  console.log(`\n🔴 EMINENT INTELLIGENCE BACKEND ONLINE`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Calendar: ${!!calendar ? 'CONNECTED' : 'NOT CONFIGURED'}`);
  console.log(`   Email: ${!!process.env.RESEND_API_KEY ? 'CONNECTED' : 'NOT CONFIGURED'}`);
  console.log(`   SMS: ${!!process.env.TWILIO_ACCOUNT_SID ? 'CONNECTED' : 'NOT CONFIGURED'}\n`);
});
