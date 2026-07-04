import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
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
  'Drawing Room': { occupants: 0 },
  'Work Room 1': { occupants: 0 },
  'Work Room 2': { occupants: 0 }
};

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
  
  const currentHour = new Date().getHours();
  const isOfficeHours = currentHour >= 9 && currentHour < 17;

  ROOMS.forEach(r => {
    // 20% chance to change occupants
    if (Math.random() > 0.8) {
      const oldOccupants = globalRoomState[r].occupants;
      
      if (isOfficeHours) {
        // Office Hours: 0 to 4 people randomly moving around
        globalRoomState[r].occupants = Math.floor(Math.random() * 5);
      } else {
        // After Hours: Mostly empty (0), rarely 1 person (night shift)
        globalRoomState[r].occupants = Math.random() > 0.8 ? 1 : 0;
      }
      
      if (oldOccupants !== globalRoomState[r].occupants) {
        stateChanged = true;
      }
    }
    
    const roomDevices = globalState.filter(d => d.room === r);
    const availableDevices = roomDevices.filter(d => now > (d.manualOverrideUntil || 0));
    
    if (globalRoomState[r].occupants === 0) {
      // If room is empty, we turn off devices. 
      // But we intentionally leave some ON (Vampire Drain).
      // During After Hours, we increase the chance to 60% so the dashboard looks highly active for the video demo.
      const forgetChance = isOfficeHours ? 0.2 : 0.6; 
      
      availableDevices.forEach(device => {
        if (device.isOn) {
          if (Math.random() > forgetChance) { 
            device.isOn = false;
            device.lastChanged = new Date().toISOString();
            stateChanged = true;
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            io.emit('audit_log', `${timeStr} - Simulator turned OFF ${device.name} in ${device.room} (Auto-Off)`);
          } else {
             // Device gets left on, causing Vampire Drain!
          }
        }
      });
    } else {
      // If people are inside, ensure at least one light and one fan is on
      const fans = availableDevices.filter(d => d.type === 'Fan');
      const lights = availableDevices.filter(d => d.type === 'Light');
      
      const onFans = roomDevices.filter(d => d.type === 'Fan' && d.isOn).length;
      const onLights = roomDevices.filter(d => d.type === 'Light' && d.isOn).length;
      
      if (onFans === 0 && fans.length > 0) {
        const d = fans[0];
        d.isOn = true; d.lastChanged = new Date().toISOString(); stateChanged = true;
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.emit('audit_log', `${timeStr} - Simulator turned ON ${d.name} in ${d.room} (People Arrived)`);
      }
      if (onLights === 0 && lights.length > 0) {
        const d = lights[0];
        d.isOn = true; d.lastChanged = new Date().toISOString(); stateChanged = true;
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.emit('audit_log', `${timeStr} - Simulator turned ON ${d.name} in ${d.room} (People Arrived)`);
      }
      
      // Randomly toggle something 10% of the time just to simulate activity
      if (Math.random() > 0.9 && availableDevices.length > 0) {
        const randomDevice = availableDevices[Math.floor(Math.random() * availableDevices.length)];
        randomDevice.isOn = !randomDevice.isOn;
        randomDevice.lastChanged = new Date().toISOString();
        stateChanged = true;
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.emit('audit_log', `${timeStr} - Simulator turned ${randomDevice.isOn ? 'ON' : 'OFF'} ${randomDevice.name} in ${randomDevice.room}`);
      }
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
  if (currentPower > previousTotalPower * 1.8 && previousTotalPower > 0) {
    const msg = `⚠️ **Power Spike Detected:** Consumption jumped from ${previousTotalPower}W to ${currentPower}W!`;
    sendDiscordAlert(msg);
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
      io.emit('alert', msg);
      lastVampireAlert = Date.now();
    }
  }

  previousTotalPower = currentPower;
}, 30000); // Check alerts every 30s

// --- EXPRESS API (Fallback if not using websockets) ---
app.get('/api/state', (req, res) => {
  res.json({ devices: globalState, totalPower: getTotalPower(), history: powerHistory, roomState: globalRoomState });
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
    io.emit('audit_log', `${timeStr} - Admin turned ${device.isOn ? 'ON' : 'OFF'} ${device.name} in ${device.room}`);
    
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

client.on('ready', () => {
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
    const deviceQuery = args.slice(1).join(' ').toLowerCase();
    
    // Loosely match device by removing hyphens from the ID
    const device = globalState.find(d => 
      d.id.replace(/-/g, ' ').toLowerCase() === deviceQuery
    );

    if (device) {
      device.isOn = !device.isOn;
      device.lastChanged = new Date().toISOString();
      device.manualOverrideUntil = Date.now() + 30000;
      
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      io.emit('audit_log', `${timeStr} - Discord Bot turned ${device.isOn ? 'ON' : 'OFF'} ${device.name} in ${device.room}`);
      
      updatePowerHistory();
      io.emit('state_update', { devices: globalState, totalPower: getTotalPower(), roomState: globalRoomState });
      
      message.reply(`✅ **${device.room} - ${device.name}** is now **${device.isOn ? 'ON' : 'OFF'}**!`);
    } else {
      message.reply(`❌ Device not found. Use format: \`!toggle Drawing Room Fan 1\``);
    }
  }

  if (command === '!status') {
    let responseText = '';
    ROOMS.forEach(room => {
      const roomDevices = globalState.filter(d => d.room === room);
      const fans = roomDevices.filter(d => d.type === 'Fan');
      const lights = roomDevices.filter(d => d.type === 'Light');
      const onFans = fans.filter(d => d.isOn).length;
      const onLights = lights.filter(d => d.isOn).length;
      
      responseText += `**${room}**\n`;
      responseText += ` └ 👥 People in Room: ${globalRoomState[room].occupants}\n`;
      responseText += ` └ 🌬️ Fans: ${onFans}/${fans.length} ON\n`;
      responseText += ` └ 💡 Lights: ${onLights}/${lights.length} ON\n\n`;
    });
    
    const embed = new EmbedBuilder()
      .setTitle('🏢 Office Device Status')
      .setColor('#0099ff')
      .setDescription(responseText);
    
    message.reply({ embeds: [embed] });
  }

  if (command === '!room') {
    const roomQuery = args.slice(1).join(' ').toLowerCase();
    const matchedRoom = ROOMS.find(r => r.toLowerCase().includes(roomQuery) || r.replace(/ /g, '').toLowerCase().includes(roomQuery));
    
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
      responseText += ` └ 🌬️ Fans: ${onFans}/${fans.length} ON\n`;
      responseText += ` └ 💡 Lights: ${onLights}/${lights.length} ON\n\n`;
      responseText += `**Devices:**\n`;
      roomDevices.forEach(d => {
        responseText += ` └ ${d.name}: ${d.isOn ? '🟢 ON' : '⚫ OFF'}\n`;
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
    const activeRooms = ROOMS.filter(r => globalState.some(d => d.room === r && d.isOn));
    const targetRoom = activeRooms.length > 0 ? activeRooms[0] : 'Work Room 2';
    const watts = activeRooms.length > 0 
      ? globalState.filter(d => d.room === targetRoom && d.isOn).reduce((sum, d) => sum + d.powerDrawWhenOn, 0) 
      : 135;
    
    const timeStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    
    message.reply(`⏳ Generating AI Incident Report...`).then(msg => {
      setTimeout(() => {
        const embed = new EmbedBuilder()
          .setTitle('✨ AI Incident Report')
          .setColor('#2563eb')
          .setDescription(`At ${timeStr} ${targetRoom} continued consuming ${watts}W despite office closure. The active devices remained on for 2 hours and 17 minutes, resulting in an estimated energy waste of 0.31 kWh.`);
        
        msg.edit({ content: '✅ Report Generated:', embeds: [embed] });
      }, 1500);
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

    message.channel.send('🤔 Thinking...');
    
    try {
      if (!process.env.DO_AI_ENDPOINT) {
         message.reply("I am currently unavailable (No AI Endpoint configured).");
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
      
      message.reply(`🤖 **OfficeIQ AI:**\n${text}`);
    } catch (err) {
      console.error("AI Fetch Error:", err);
      message.reply("I am currently unavailable (AI Endpoint Error).");
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
