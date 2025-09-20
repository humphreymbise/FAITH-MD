const {
  default: makeWASocket,
  useSingleFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const http = require('http');
const { Boom } = require('@hapi/boom');
const { decode } = require('base64-arraybuffer');
const config = require('./config');

// 📂 Auth folder setup (works with Railway Volumes at /app/auth)
const AUTH_DIR = path.join(process.cwd(), 'auth');
fs.mkdirSync(AUTH_DIR, { recursive: true });
const CREDS_PATH = path.join(AUTH_DIR, 'creds.json');

// 🔐 Decode SESSION_ID (format: ALONE-MD;;;=><base64>)
if (config.SESSION_ID) {
  try {
    const sessionData = config.SESSION_ID.split(';;;=>')[1];
    fs.writeFileSync(CREDS_PATH, Buffer.from(decode(sessionData)));
  } catch (err) {
    console.error("❌ Failed to decode SESSION_ID:", err);
  }
}

const { state, saveState } = useSingleFileAuthState(CREDS_PATH);
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

async function startBot() {
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    browser: ['The100-MD', 'Safari', '1.0.0'],
    auth: state,
    printQRInTerminal: false,
    getMessage: async () => null,
  });

  store.bind(sock.ev);
  sock.ev.on('creds.update', saveState);

  // 🔁 Connection handling
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(shouldReconnect ? '🌀 Reconnecting...' : '❌ Logged out.');
      if (shouldReconnect) startBot();
    }

    if (connection === 'open') {
      console.log('✅ Bot connected.');
    }
  });

  // 📦 Plugin loading
  const PLUGIN_DIR = path.join(__dirname, 'The100Md_plugins');
  if (fs.existsSync(PLUGIN_DIR)) {
    const plugins = fs
      .readdirSync(PLUGIN_DIR)
      .filter((file) => file.endsWith('.js'))
      .map((file) => require(path.join(PLUGIN_DIR, file)));

    // ⚙️ Message handler
    sock.ev.on('messages.upsert', async ({ messages }) => {
      const msg = messages[0];
      if (!msg?.message || msg.key.fromMe) return;

      const from = msg.key.remoteJid;
      const sender = msg.key.participant || msg.key.remoteJid;

      // 🟢 Set presence if enabled
      if (config.WA_PRESENCE) {
        try {
          await sock.sendPresenceUpdate(config.AUTO_SETPRESENCE, from);
        } catch {}
      }

      // 👁 Auto status view
      if (config.AUTO_STATUS_VIEW === 'true' && from === 'status@broadcast') {
        try {
          await sock.readMessages([msg.key]);
        } catch {}
        return;
      }

      // 🧠 Extract command
      const body =
        msg.message.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '';
      const command = body.startsWith(config.PREFIX)
        ? body.slice(1).split(' ')[0].toLowerCase()
        : null;

      if (!command) return;

      // 🔒 Restrict channels to owner only
      if (from.endsWith('@newsletter') && !config.OWNER_NUMBER.includes(sender.split('@')[0])) {
        return sock.sendMessage(
          from,
          { text: '🔒 Only owner can use the bot in channels.' },
          { quoted: msg }
        );
      }

      // 🚀 Run plugins
      for (const plugin of plugins) {
        try {
          if (plugin.pattern?.toLowerCase() === command) {
            await plugin.run({ sock, msg, from, command, config, coms: plugins });
          }
        } catch (err) {
          console.error(`❌ Plugin error:`, err);
          sock.sendMessage(from, { text: '⚠️ Command error.' }, { quoted: msg });
        }
      }
    });
  } else {
    console.log("⚠️ No plugins folder found. Skipping plugin load.");
  }
}

// 🌐 Keep alive (for Railway public URL)
http.createServer((_, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('✅ Bot is alive.');
}).listen(process.env.PORT || 8080);

// 🚀 Launch
startBot();
