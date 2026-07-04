import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Client, GatewayIntentBits, EmbedBuilder, Events } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
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
let globalRoomState = {
  'Drawing Room': { occupants: 0, alertSentForThisCycle: false },
  'Work Room 1': { occupants: 0, alertSentForThisCycle: false },
  'Work Room 2': { occupants: 0, alertSentForThisCycle: false }
};
let globalAlerts = [];

function addGlobalAlert(msg) {
  globalAlerts.unshift({ id: Date.now() + Math.random(), msg, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  if (globalAlerts.length > 50) globalAlerts.pop();
}

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

// --- SMART SIMULATOR LOOP ---
// Toggles devices based on occupancy, ignoring recently manual toggled devices
setInterval(() => {
  const now = Date.now();
  let stateChanged = false;

  // Get accurate local time in Dhaka, regardless of AWS server settings
  const dhakaTime = new Date().toLocaleString("en-US", {timeZone: "Asia/Dhaka"});
  const currentHour = new Date(dhakaTime).getHours();
  const isOfficeHours = currentHour >= 9 && currentHour < 17;

  ROOMS.forEach(r => {
    // 10% chance to change occupants every 10 seconds
    if (Math.random() > 0.9) {
      const oldOccupants = globalRoomState[r].occupants;
      
      if (isOfficeHours) {
        // Office Hours: 0 to 4 people
        globalRoomState[r].occupants = Math.floor(Math.random() * 5);
      } else {
        // After Hours: Mostly 0, rarely 1 person
        globalRoomState[r].occupants = Math.random() > 0.85 ? 1 : 0;
      }
      
      if (oldOccupants !== globalRoomState[r].occupants) {
        stateChanged = true;
      }
    }

    const roomDevices = globalState.filter(d => d.room === r);
    const availableDevices = roomDevices.filter(d => now > (d.manualOverrideUntil || 0));

    if (globalRoomState[r].occupants === 0) {
      // ROOM IS EMPTY: Vampire Drain Logic
      // 70% chance to be ON during office hours, 40% chance to be ON after hours.
      const vampireChance = isOfficeHours ? 0.70 : 0.50;
      
      availableDevices.forEach(device => {
        // 15% chance per tick to rethink its state, creating a slow, random "popcorn" effect
        if (Math.random() > 0.85) {
          const shouldBeOn = Math.random() < vampireChance;
          if (device.isOn !== shouldBeOn) {
            device.isOn = shouldBeOn;
            device.lastChanged = new Date().toISOString();
            stateChanged = true;
          }
        }
      });
    } else {
      // ROOM IS OCCUPIED: Totally random, but high chance to be ON
      const activeChance = 0.85; // 85% chance for any device to be ON when people are here
      
      availableDevices.forEach(device => {
        // 20% chance per tick to rethink its state
        if (Math.random() > 0.80) {
          const shouldBeOn = Math.random() < activeChance;
          if (device.isOn !== shouldBeOn) {
            device.isOn = shouldBeOn;
            device.lastChanged = new Date().toISOString();
            stateChanged = true;
          }
        }
      });
    }
  });

  if (stateChanged) {
    updatePowerHistory();
  }

  // Push state to all connected web clients
  io.emit('state_update', { devices: globalState, totalPower: getTotalPower(), roomState: globalRoomState });

}, 10000); // 10 seconds

// Power history logging every 1 minute
setInterval(updatePowerHistory, 60000);

// --- ALERT ENGINE ---
let previousTotalPower = 0;
let lastVampireAlert = 0;
setInterval(() => {
  const currentPower = getTotalPower();

  // 1. Power Spike Alert
  // Requires both a 1.8x jump AND an absolute jump of at least 100W to prevent spam from a single fan turning on
  if (currentPower > previousTotalPower * 1.8 && (currentPower - previousTotalPower) >= 100 && previousTotalPower > 0) {
    const msg = `⚠️ **Power Spike Detected:** Consumption jumped from ${previousTotalPower}W to ${currentPower}W!`;
    sendDiscordAlert(msg);
    addGlobalAlert(msg);
    io.emit('alert', msg);
  }

  // 2. Vampire Drain (The PDF explicitly states: "assume office hours are 9 AM–5 PM")
  // So after hours is anything from 5 PM (17:00) to 8:59 AM (08:59).
  const hour = new Date().getHours();
  if (hour >= 17 || hour < 9) {
    // Only alert once every 10 minutes to prevent spam
    if (currentPower > 0 && Date.now() - lastVampireAlert > 600000) {
      const emptyRoomsWithPower = ROOMS.filter(r => globalRoomState[r].occupants === 0 && globalState.some(d => d.room === r && d.isOn));
      let msg = `🦇 **Vampire Drain:** ${currentPower}W being consumed after hours.`;

      if (emptyRoomsWithPower.length > 0) {
        const targetRoom = emptyRoomsWithPower[0];
        const onFans = globalState.filter(d => d.room === targetRoom && d.type === 'Fan' && d.isOn).length;
        const onLights = globalState.filter(d => d.room === targetRoom && d.type === 'Light' && d.isOn).length;
        const timeFormatted = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        msg = `Hey! ${targetRoom} still has ${onFans} fans and ${onLights} lights ON and it's ${timeFormatted}. Did someone forget to leave?`;
      }

      sendDiscordAlert(msg);
      addGlobalAlert(msg);
      io.emit('alert', msg);
      lastVampireAlert = Date.now();
    }
  }

  // 3. Continuous Runtime Alert (All devices in a room ON for a long time)
  // For the hackathon demo, we scale "2 hours" down to "2 minutes" (120000ms) so judges can see it live.
  ROOMS.forEach(r => {
    const roomDevices = globalState.filter(d => d.room === r);
    const allOn = roomDevices.length > 0 && roomDevices.every(d => d.isOn);
    
    if (allOn) {
      const allOnSince = Math.max(...roomDevices.map(d => new Date(d.lastChanged).getTime()));
      if (Date.now() - allOnSince > 120000) {
        if (!globalRoomState[r].alertSentForThisCycle) {
          const msg = `🚨 **Energy Waste:** All devices in **${r}** have been running continuously for a long time!`;
          sendDiscordAlert(msg);
          addGlobalAlert(msg);
          io.emit('alert', msg);
          globalRoomState[r].alertSentForThisCycle = true;
        }
      }
    } else {
      globalRoomState[r].alertSentForThisCycle = false;
    }
  });

  previousTotalPower = currentPower;
}, 30000); // Check alerts every 30s

// --- EXPRESS API (Fallback if not using websockets) ---
app.get('/api/state', (req, res) => {
  res.json({ devices: globalState, totalPower: getTotalPower(), history: powerHistory, roomState: globalRoomState, alerts: globalAlerts });
});

// Enterprise API for toggling devices
app.patch('/api/devices/:id', (req, res) => {
  const device = globalState.find(d => d.id === req.params.id);
  if (device && req.body && typeof req.body.isOn === 'boolean') {
    device.isOn = req.body.isOn;
    device.lastChanged = new Date().toISOString();
    device.manualOverrideUntil = Date.now() + 30000; // 30 seconds protection from Simulator

    // Audit Log
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const auditMsg = `${timeStr} - Admin turned ${device.isOn ? 'ON' : 'OFF'} ${device.name} in ${device.room}`;
    addGlobalAlert(auditMsg);
    io.emit('audit_log', auditMsg);

    // Force immediate graph update
    updatePowerHistory();
    io.emit('state_update', { devices: globalState, totalPower: getTotalPower(), roomState: globalRoomState });
    res.json(device);
  } else {
    res.status(404).send('Device not found or invalid payload');
  }
});

// --- DISCORD BOT ---
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.on(Events.ClientReady, () => {
  console.log(`Discord Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/g);
  const command = args[0].toLowerCase();

  // Core Commands
  if (command === '!help') {
    const embed = new EmbedBuilder()
      .setTitle('🛠️ OfficeIQ Bot Commands')
      .setColor('#f59e0b')
      .setDescription('Here are all the available commands to control and monitor the office:')
      .addFields(
        { name: '`!status`', value: 'Shows an overview of all rooms (occupants, fans, lights).' },
        { name: '`!room <name>`', value: 'Shows detailed status of a specific room (e.g. `!room work 1`).' },
        { name: '`!toggle <device>`', value: 'Turns a specific device ON/OFF (e.g. `!toggle Drawing Room Fan 1`).' },
        { name: '`!usage`', value: 'Shows total current power usage and estimated cost rate.' },
        { name: '`!report`', value: 'Generates an AI incident report for any after-hours energy waste.' },
        { name: '`!boss`', value: 'Asks the AI facilities manager for a sarcastic analysis of current usage.' }
      )
      .setFooter({ text: 'OfficeIQ Smart System' });

    message.reply({ embeds: [embed] });
  }

  if (command === '!toggle') {
    if (args.length < 2) {
      message.reply(`❌ Please specify a device. Try \`!toggle drawing fan 1\``);
      return;
    }
    const deviceQuery = args.slice(1).join(' ').toLowerCase();
    const queryWords = deviceQuery.split(' ');

    const device = globalState.find(d => {
      const idLower = d.id.toLowerCase();
      return queryWords.every(word => idLower.includes(word));
    });

    if (device) {
      device.isOn = !device.isOn;
      device.lastChanged = new Date().toISOString();
      device.manualOverrideUntil = Date.now() + 30000;

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const auditMsg = `${timeStr} - Discord Bot turned ${device.isOn ? 'ON' : 'OFF'} ${device.name} in ${device.room}`;
      addGlobalAlert(auditMsg);
      io.emit('audit_log', auditMsg);

      updatePowerHistory();
      io.emit('state_update', { devices: globalState, totalPower: getTotalPower(), roomState: globalRoomState });

      message.reply(`✅ **${device.room} - ${device.name}** is now **${device.isOn ? 'ON' : 'OFF'}**!`);
    } else {
      message.reply(`❌ Device not found. Use format: \`!toggle Drawing Room Fan 1\``);
    }
  }

  if (command === '!test2hour') {
    const msg = `🚨 **[TEST] Energy Waste:** All devices in **Drawing Room** have been running continuously for more than 2 hours!`;
    addGlobalAlert(msg);
    io.emit('alert', msg);
    message.reply(`✅ Triggered test alert! Check the dashboard alerts panel.`);
  }

  if (command === '!status') {
    let responseText = '';
    ROOMS.forEach(room => {
      const roomDevices = globalState.filter(d => d.room === room);
      const fans = roomDevices.filter(d => d.type === 'Fan');
      const lights = roomDevices.filter(d => d.type === 'Light');
      const onFans = fans.filter(d => d.isOn).length;
      const onLights = lights.filter(d => d.isOn).length;
      const fanPower = fans.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
      const lightPower = lights.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);

      responseText += `**${room}**\n`;
      responseText += ` └ 👥 People in Room: ${globalRoomState[room].occupants}\n`;
      responseText += ` └ 🌬️ Fans: ${onFans}/${fans.length} ON (${fanPower}W)\n`;
      responseText += ` └ 💡 Lights: ${onLights}/${lights.length} ON (${lightPower}W)\n`;
      
      const allOn = roomDevices.length > 0 && roomDevices.every(d => d.isOn);
      if (allOn) {
        const allOnSince = Math.max(...roomDevices.map(d => new Date(d.lastChanged).getTime()));
        const diffMs = Date.now() - allOnSince;
        const diffMins = Math.floor(diffMs / 60000);
        const diffSecs = Math.floor((diffMs % 60000) / 1000);
        responseText += ` └ ⏱️ All ON for: ${diffMins}m ${diffSecs}s\n`;
      }
      responseText += `\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('🏢 Office Device Status')
      .setColor('#0099ff')
      .setDescription(responseText);

    message.reply({ embeds: [embed] });
  }

  if (command === '!room') {
    const roomQuery = args.slice(1).join(' ').toLowerCase();
    
    if (!roomQuery) {
      message.reply(`❌ Please specify a room. Try \`!room drawing\` or \`!room work 1\``);
      return;
    }

    const queryWords = roomQuery.toLowerCase().split(' ');
    const matchedRoom = ROOMS.find(r => {
      const roomLower = r.toLowerCase();
      return queryWords.every(word => roomLower.includes(word));
    });

    if (matchedRoom) {
      const roomDevices = globalState.filter(d => d.room === matchedRoom);
      const fans = roomDevices.filter(d => d.type === 'Fan');
      const lights = roomDevices.filter(d => d.type === 'Light');
      const onFans = fans.filter(d => d.isOn).length;
      const onLights = lights.filter(d => d.isOn).length;
      const roomPower = roomDevices.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);

      let responseText = `**${matchedRoom}**\n`;
      responseText += ` └ 👥 People in Room: ${globalRoomState[matchedRoom].occupants}\n`;
      responseText += ` └ ⚡ Current Power: ${roomPower}W\n`;
      
      const allOn = roomDevices.length > 0 && roomDevices.every(d => d.isOn);
      if (allOn) {
        const allOnSince = Math.max(...roomDevices.map(d => new Date(d.lastChanged).getTime()));
        const diffMs = Date.now() - allOnSince;
        const diffMins = Math.floor(diffMs / 60000);
        const diffSecs = Math.floor((diffMs % 60000) / 1000);
        responseText += ` └ ⏱️ ⚠️ All ON for: ${diffMins}m ${diffSecs}s\n`;
      }
      
      responseText += ` └ 🌬️ Fans: ${onFans}/${fans.length} ON\n`;
      responseText += ` └ 💡 Lights: ${onLights}/${lights.length} ON\n\n`;
      responseText += `**Devices:**\n`;
      roomDevices.forEach(d => {
        let stateStr = d.isOn ? '🟢 ON ' : '⚫ OFF';
        
        if (d.isOn && d.lastChanged) {
          const diffMs = Date.now() - new Date(d.lastChanged).getTime();
          const diffMins = Math.floor(diffMs / 60000);
          const diffSecs = Math.floor((diffMs % 60000) / 1000);
          stateStr += ` (running for ${diffMins}m ${diffSecs}s)`;
        }
        
        responseText += ` └ ${d.name}: ${stateStr}\n`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`🏢 Room Status: ${matchedRoom}`)
        .setColor('#10b981')
        .setDescription(responseText);

      message.reply({ embeds: [embed] });
    } else {
      message.reply(`❌ Room not found. Try \`!room drawing\` or \`!room work 1\``);
    }
  }

  if (command === '!report') {
    const watts = getTotalPower();
    const activeDevices = globalState.filter(d => d.isOn).map(d => `${d.name} in ${d.room}`).join(', ');
    const occupiedRooms = ROOMS.filter(r => globalRoomState[r].occupants > 0).map(r => `${r} (${globalRoomState[r].occupants} people)`).join(', ');
    
    const systemPrompt = "You are OfficeIQ, an enterprise AI reporting agent. Generate a concise, professional 3-sentence incident report about the current office energy usage. If there is high usage or devices are left on in empty rooms, identify it as a waste incident. Use a formal tone.";
    const userPrompt = `${systemPrompt}\n\nContext: Current total power is ${watts}W. Occupied rooms: ${occupiedRooms || 'None'}. Active devices: ${activeDevices || 'None'}. Provide the incident report.`;

    message.reply(`⏳ Generating AI Incident Report...`).then(async (msg) => {
      try {
        if (!process.env.DO_AI_ENDPOINT) {
          msg.edit("❌ I am currently unavailable (No AI Endpoint configured).");
          return;
        }

        const aiResponse = await fetch(process.env.DO_AI_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DO_AI_API_KEY}`
          },
          body: JSON.stringify({
            messages: [{ role: "user", content: userPrompt }]
          })
        });

        if (!aiResponse.ok) throw new Error("API Error");
        
        const data = await aiResponse.json();
        const text = data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content
          : "Report generation failed.";
          
        const embed = new EmbedBuilder()
          .setTitle('✨ AI Incident Report')
          .setColor('#2563eb')
          .setDescription(text);

        msg.edit({ content: '✅ Report Generated:', embeds: [embed] });
      } catch (err) {
        msg.edit("❌ Report generation failed (AI Error).");
      }
    });
  }

  if (command === '!usage') {
    const watts = getTotalPower();
    // Dummy conversion: 1000W for 1 hour = 1 kWh. Say 10 BDT per kWh.
    const costPerHour = (watts / 1000) * 10;
    message.reply(`⚡ **Current Usage:** ${watts}W.\n💸 **Estimated Cost Rate:** ৳${costPerHour.toFixed(2)} BDT / hour.`);
  }

  // AI Enhanced Command
  if (command === '!boss') {
    const question = args.slice(1).join(' ');
    const watts = getTotalPower();

    // Build real simulated data context
    const activeDevices = globalState.filter(d => d.isOn).map(d => `${d.name} in ${d.room}`).join(', ');
    const occupiedRooms = ROOMS.filter(r => globalRoomState[r].occupants > 0).map(r => `${r} (${globalRoomState[r].occupants} people)`).join(', ');
    const context = `Current office state: ${watts}W total power. Occupied rooms: ${occupiedRooms || 'None'}. Devices currently ON: ${activeDevices || 'None'}.`;

    const systemPrompt = "You are OfficeIQ, a highly intelligent, humanized, and friendly AI assistant managing an office building. The boss hates robotic data dumps, so always provide conversational, helpful, and natural answers based EXACTLY on the real-time context provided. Keep your answers under 3 sentences.";
    const userPrompt = `${systemPrompt}\n\nContext: ${context}\n\nBoss asks: ${question || "How is the office looking right now?"}`;

    message.reply('🤔 Thinking...').then(async (msg) => {
      try {
        if (!process.env.DO_AI_ENDPOINT) {
          msg.edit("❌ I am currently unavailable (No AI Endpoint configured).");
          return;
        }

        // Call DigitalOcean AI Agent endpoint (OpenAI compatible format)
        const aiResponse = await fetch(process.env.DO_AI_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DO_AI_API_KEY}`
          },
          body: JSON.stringify({
            messages: [
              { role: "user", content: userPrompt }
            ]
          })
        });

        if (!aiResponse.ok) {
          throw new Error(`HTTP error! status: ${aiResponse.status}`);
        }

        const data = await aiResponse.json();
        const text = data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content
          : "I'm a bit speechless right now.";

        msg.edit(`🤖 **OfficeIQ AI:**\n${text}`);
      } catch (err) {
        console.error("AI Fetch Error:", err);
        msg.edit("❌ I am currently unavailable (AI Endpoint Error).");
      }
    });
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
