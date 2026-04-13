const fs = require("fs-extra");
const qrcode = require("qrcode");
const TelegramBot = require("node-telegram-bot-api");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");

const config = require("./config");
const GROUPS = require("./groups");

const STATE_FILE = "./state.json";

let state = fs.existsSync(STATE_FILE)
  ? fs.readJsonSync(STATE_FILE)
  : { groups: {}, logs: [], timers: {} };

function save() {
  fs.writeJsonSync(STATE_FILE, state, { spaces: 2 });
}

// ===== TELEGRAM BOT =====
const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

// ===== TELEGRAM CLIENT =====
const tgClient = new TelegramClient(
  new StringSession(config.TELEGRAM.session),
  config.TELEGRAM.apiId,
  config.TELEGRAM.apiHash,
  { connectionRetries: 5 }
);

// ===== LEVEL =====
function detectLevel(text) {
  if (text.includes("Blue")) return "blue";
  if (text.includes("Green")) return "green";
  if (text.includes("Yellow")) return "yellow";
  if (text.includes("Red")) return "red";
  return null;
}

// ===== UPDATE GROUP =====
function updateGroup(groupId, text) {
  const level = detectLevel(text);
  if (!level) return;

  state.groups[groupId] = {
    level,
    time: Date.now()
  };

  save();
}

// ===== WHATSAPP =====
async function startWA() {
  const { state: auth, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({ auth });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect } = update;
  
    if (qr) {
      console.log("📱 QR RECEIVED");
  
      try {
        const qrImg = await qrcode.toBuffer(qr);
  
        await bot.sendPhoto(config.ALERT_CHANNEL, qrImg, {
          caption: "🔐 WhatsApp QR — відскануй"
        });
  
        console.log("✅ QR sent to Telegram");
      } catch (err) {
        console.log("❌ QR send error:", err.message);
      }
    }
  
    if (connection === "open") {
      console.log("✅ WhatsApp CONNECTED");
    }
  
    if (connection === "close") {
      console.log("❌ WA closed:", lastDisconnect?.error);
    }
  });

  sock.ev.on("messages.upsert", ({ messages }) => {
    const m = messages[0];
    if (!m.message) return;

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      "";

    updateGroup(m.key.remoteJid, text);
  });
}

// ===== TELEGRAM =====
function parseTG(text) {
  if (text.includes("Повітряна тривога")) return "blue";
  if (text.includes("Відбій")) return "green";
  return null;
}

function processAlert(text) {
  const type = parseTG(text);
  if (!type) return;

  Object.values(GROUPS).forEach(region => {
    if (!region.aliases.some(a => text.includes(a))) return;

    const current = state.groups[region.groupId];

    if (current && current.level !== "green") return;

    if (state.timers[region.groupId]) return;

    state.timers[region.groupId] = true;

    setTimeout(() => {
      const updated = state.groups[region.groupId];

      if (!updated || updated.level !== type) {
        bot.sendMessage(
          config.ALERT_CHANNEL,
          `❗❗❗ Увага, не виставлено ${type === "blue" ? "🔷 синій" : "✅ зелений"} в ${region.groupName}`
        );

        state.logs.push({
          group: region.groupName,
          time: new Date().toISOString(),
          result: "missed"
        });
      }

      delete state.timers[region.groupId];
      save();
    }, config.DELAY);

    save();
  });
}

// ===== START TG =====
async function startTG() {
  await tgClient.start();

  tgClient.addEventHandler(event => {
    try {
      const msg = event.message;
  
      if (!msg) return;
      if (!msg.message) return;
      if (typeof msg.message !== "string") return;
  
      processAlert(msg.message);
  
    } catch (err) {
      console.log("TG parse error:", err.message);
    }
  });
}

// ===== START =====
(async () => {
  await startWA();
  await startTG();
})();