const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const fs = require('fs');

// Express setup for Heroku deployment
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (_, res) => res.send('Bot is running! ✅'));
app.listen(PORT, () => console.log(`Bot listening on port ${PORT}`));

// Auth state file setup
const { state, saveState } = useSingleFileAuthState('./auth_info.json');

// Function to start the WhatsApp bot
async function startBot() {
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    // Save credentials on update
    sock.ev.on('creds.update', saveState);

    // Connection updates
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;

            console.log('Connection closed due to:', lastDisconnect?.error);
            console.log('Reconnect:', shouldReconnect);

            if (shouldReconnect) {
                startBot(); // Reconnect on non-logout
            } else {
                console.log('Logged out. Delete auth_info.json and restart to rescan QR.');
            }

        } else if (connection === 'open') {
            console.log('✅ BOT CONNECTED TO WHATSAPP');
        }
    });

    // Message event
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const messageContent = msg.message.conversation || msg.message.extendedTextMessage?.text;

        console.log('📩 Message received:', messageContent);

        if (messageContent?.toLowerCase() === 'ping') {
            await sock.sendMessage(sender, { text: 'pong 🏓' });
        }
    });
}

// Start the bot
startBot();
