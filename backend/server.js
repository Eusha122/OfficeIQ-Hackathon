import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// --- STATE MANAGEMENT (Single Source of Truth) ---
const ROOMS = ['Drawing Room', 'Work Room 1', 'Work Room 2'];
const DEVICE_TYPES = [
  { type: 'Fan', id: 1, power: 60 },
  { type: 'Fan', id: 2, power: 60 },
  { type: 'Light', id: 1, power: 15 },
  { type: 'Light', id: 2, power: 15 },
  { type: 'Light', id: 3, power: 15 }
];

let globalState = [];
let powerHistory = []; // Stores last 30 minutes of power data [{ time, watts }]

// Initialize State
ROOMS.forEach(room => {
  DEVICE_TYPES.forEach(dev => {
    globalState.push({
      id: `${room}-${dev.type}-${dev.id}`,
      room: room,
      type: dev.type,
      name: `${dev.type} ${dev.id}`,
      isOn: false,
      powerDrawWhenOn: dev.power,
      lastChanged: new Date().toISOString()
    });
  });
});

// --- HELPER FUNCTIONS ---
function getTotalPower() {
  return globalState.reduce((sum, dev) => dev.isOn ? sum + dev.powerDrawWhenOn : sum, 0);
}

function updatePowerHistory() {
  const now = new Date();
  powerHistory.push({ time: now.toLocaleTimeString(), watts: getTotalPower() });
  if (powerHistory.length > 30) powerHistory.shift(); // Keep last 30 readings
}

// --- SIMULATOR LOOP ---
// Toggles random devices to simulate real usage
setInterval(() => {
  const randomDeviceIndex = Math.floor(Math.random() * globalState.length);
  const device = globalState[randomDeviceIndex];
  device.isOn = !device.isOn;
  device.lastChanged = new Date().toISOString();
  
  // Push state to all connected web clients
  io.emit('state_update', { devices: globalState, totalPower: getTotalPower() });
}, 10000); // 10 seconds

// Power history logging every 1 minute
setInterval(updatePowerHistory, 60000);

// --- ALERT ENGINE ---
let previousTotalPower = 0;
setInterval(() => {
  const currentPower = getTotalPower();
  
  // 1. Power Spike Alert
  if (currentPower > previousTotalPower * 1.8 && previousTotalPower > 0) {
    const msg = `⚠️ **Power Spike Detected:** Consumption jumped from ${previousTotalPower}W to ${currentPower}W!`;
    sendDiscordAlert(msg);
    io.emit('alert', msg);
  }
  
  // 2. Vampire Drain (Assuming current time is after hours for simulation)
  const hour = new Date().getHours();
  if (hour >= 20 || hour <= 6) {
    if (currentPower > 0) {
      // We throttle this alert in a real app, but for hackathon demo we can show it
      io.emit('alert', `🦇 **Vampire Drain:** ${currentPower}W being consumed after hours.`);
    }
  }

  previousTotalPower = currentPower;
}, 30000); // Check alerts every 30s

// --- EXPRESS API (Fallback if not using websockets) ---
app.get('/api/state', (req, res) => {
  res.json({ devices: globalState, totalPower: getTotalPower(), history: powerHistory });
});

// Secret Weapon: Force state for demo purposes
app.post('/api/force-state/:id/:state', (req, res) => {
  const device = globalState.find(d => d.id === req.params.id);
  if (device) {
    device.isOn = req.params.state === 'on';
    device.lastChanged = new Date().toISOString();
    io.emit('state_update', { devices: globalState, totalPower: getTotalPower() });
    res.send('OK');
  } else {
    res.status(404).send('Device not found');
  }
});

// --- DISCORD BOT ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.on('ready', () => {
  console.log(`Discord Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/g);
  const command = args[0].toLowerCase();

  // Core Commands
  if (command === '!status') {
    let responseText = '';
    ROOMS.forEach(room => {
      const roomDevices = globalState.filter(d => d.room === room);
      const onCount = roomDevices.filter(d => d.isOn).length;
      responseText += `**${room}:** ${onCount}/${roomDevices.length} ON\n`;
    });
    
    const embed = new EmbedBuilder()
      .setTitle('🏢 Office Device Status')
      .setColor('#0099ff')
      .setDescription(responseText);
    
    message.reply({ embeds: [embed] });
  }

  if (command === '!usage') {
    const watts = getTotalPower();
    // Dummy conversion: 1000W for 1 hour = 1 kWh. Say 10 BDT per kWh.
    const costPerHour = (watts / 1000) * 10;
    message.reply(`⚡ **Current Usage:** ${watts}W.\n💸 **Estimated Cost Rate:** ৳${costPerHour.toFixed(2)} BDT / hour.`);
  }

  // AI Enhanced Command
  if (command === '!boss') {
    // Generate prompt based on state
    const watts = getTotalPower();
    const prompt = `You are an experienced facilities manager with a sarcastic personality. Analyze the office energy usage in under 2 sentences. Current state: We are drawing ${watts}W.`;
    
    message.channel.send('🤔 Thinking...');
    
    try {
      // Call existing DO AI Agent endpoint here (MiniMax M2.5)
      // const aiResponse = await fetch('YOUR_DO_ENDPOINT', { method: 'POST', body: JSON.stringify({ prompt }) });
      // const text = await aiResponse.text();
      
      // MOCK RESPONSE for now:
      const text = "Drawing Room appears committed to recreating daylight indoors after office hours. Work Room 1 deserves recognition for not personally financing the electricity provider.";
      message.reply(`👔 **Boss says:**\n"${text}"`);
    } catch (err) {
      message.reply("Boss is currently unavailable (AI Endpoint Error).");
    }
  }
});

function sendDiscordAlert(text) {
  if (!process.env.DISCORD_CHANNEL_ID) return;
  const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
  if (channel) channel.send(text);
}

if (process.env.DISCORD_TOKEN) {
  client.login(process.env.DISCORD_TOKEN);
} else {
  console.log("No DISCORD_TOKEN provided. Bot is offline.");
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
