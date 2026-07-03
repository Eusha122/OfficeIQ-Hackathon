import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Fan } from 'lucide-react'; // Using Lucide for the Fan icon

// Connect to backend (adjust URL if needed)
const socket = io('http://localhost:3001');

function App() {
  const [devices, setDevices] = useState([]);
  const [totalPower, setTotalPower] = useState(0);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    // Initial fetch to get history and current state
    fetch('http://localhost:3001/api/state')
      .then(res => res.json())
      .then(data => {
        setDevices(data.devices);
        setTotalPower(data.totalPower);
        if (data.history) setHistory(data.history);
      })
      .catch(err => console.error("API Error (Is backend running?):", err));

    // Listen for live updates
    socket.on('state_update', (data) => {
      setDevices(data.devices);
      setTotalPower(data.totalPower);
      // We push a mock history point for the demo to make the graph move fast
      setHistory(prev => {
        const newHist = [...prev, { time: new Date().toLocaleTimeString(), watts: data.totalPower }];
        return newHist.slice(-20); // Keep last 20
      });
    });

    socket.on('alert', (msg) => {
      setAlerts(prev => [{ id: Date.now(), msg }, ...prev].slice(0, 5)); // Keep last 5
    });

    return () => {
      socket.off('state_update');
      socket.off('alert');
    };
  }, []);

  // Group devices by room
  const rooms = devices.reduce((acc, dev) => {
    if (!acc[dev.room]) acc[dev.room] = [];
    acc[dev.room].push(dev);
    return acc;
  }, {});

  // Calculate Efficiency Score
  const calculateEfficiency = (roomDevices) => {
    let score = 100;
    const isAfterHours = new Date().getHours() >= 20 || new Date().getHours() <= 6;
    const roomPower = roomDevices.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
    
    if (isAfterHours && roomPower > 0) score -= 20;
    if (roomPower > 100) score -= 10;
    // (In a real app, we'd check duration, but for hackathon UI this looks great)
    return Math.max(0, score);
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'var(--success)';
    if (score >= 70) return 'var(--accent-amber)';
    return 'var(--danger)';
  };

  return (
    <>
      <header className="header">
        <h1>Office<span className="highlight">IQ</span></h1>
      </header>

      <main className="dashboard-layout">
        {/* LEFT PANEL: The Map */}
        <div className="left-panel">
          <div className="room-map">
            {Object.keys(rooms).map(roomName => {
              const roomDevices = rooms[roomName];
              return (
                <div key={roomName} className="glass-panel room-card">
                  <div className="room-title">{roomName}</div>
                  <div className="device-grid">
                    {roomDevices.map(dev => (
                      <div key={dev.id} className="device-item">
                        <div className="device-icon">
                          {dev.type === 'Fan' ? (
                            <Fan size={28} className={dev.isOn ? 'fan-on' : 'fan-off'} />
                          ) : (
                            <div style={{ width: 20, height: 20 }} className={dev.isOn ? 'light-on' : 'light-off'}></div>
                          )}
                        </div>
                        <span>{dev.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT PANEL: Analytics */}
        <div className="right-panel flex-col gap-24">
          <div className="glass-panel power-meter">
            <div className="power-value">{totalPower}W</div>
            <div className="power-label">Live Consumption</div>
          </div>

          <div className="glass-panel">
            <h3 style={{ marginBottom: 16 }}>Power History (Live) 📈</h3>
            <div style={{ height: 200, width: '100%' }}>
              <ResponsiveContainer>
                <LineChart data={history}>
                  <XAxis dataKey="time" hide />
                  <YAxis stroke="var(--text-muted)" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ background: 'var(--bg-dark)', border: 'none', borderRadius: 8 }}
                    itemStyle={{ color: 'var(--accent-cyan)' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="watts" 
                    stroke="var(--accent-cyan)" 
                    strokeWidth={3} 
                    dot={false}
                    animationDuration={300}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-panel efficiency-scores">
            <h3 style={{ marginBottom: 16 }}>Efficiency Scores</h3>
            {Object.keys(rooms).map(roomName => {
              const score = calculateEfficiency(rooms[roomName]);
              return (
                <div key={roomName} className="score-item">
                  <span>{roomName}</span>
                  <span className="score-value" style={{ color: getScoreColor(score) }}>
                    {score}/100 {score >= 90 ? '🟢' : score >= 70 ? '🟡' : '🔴'}
                  </span>
                </div>
              )
            })}
          </div>

          {alerts.length > 0 && (
            <div className="glass-panel alerts-feed">
              <h3 style={{ marginBottom: 16 }}>Active Alerts</h3>
              {alerts.map(a => (
                <div key={a.id} className="alert-item">
                  {a.msg}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}

export default App
