import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const socket = io('http://localhost:3001');

function App() {
  const [devices, setDevices] = useState([]);
  const [totalPower, setTotalPower] = useState(0);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [expandedRooms, setExpandedRooms] = useState({});
  const [activeTab, setActiveTab] = useState('Overview');

  const tabs = ['Overview', 'Rooms', 'Analytics', 'Alerts', 'Settings'];

  useEffect(() => {
    fetch('http://localhost:3001/api/state')
      .then(res => res.json())
      .then(data => {
        setDevices(data.devices);
        setTotalPower(data.totalPower);
        if (data.history) setHistory(data.history);
      })
      .catch(err => console.error(err));

    socket.on('state_update', (data) => {
      setDevices(data.devices);
      setTotalPower(data.totalPower);
      setHistory(prev => {
        const newHist = [...prev, { time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}), watts: data.totalPower }];
        return newHist.slice(-30); 
      });
    });

    socket.on('alert', (msg) => {
      setAlerts(prev => [{ id: Date.now(), msg, time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }, ...prev].slice(0, 5));
    });

    return () => {
      socket.off('state_update');
      socket.off('alert');
    };
  }, []);

  const rooms = devices.reduce((acc, dev) => {
    if (!acc[dev.room]) acc[dev.room] = [];
    acc[dev.room].push(dev);
    return acc;
  }, {});

  const calculateEfficiency = (roomDevices) => {
    let score = 100;
    const hour = new Date().getHours();
    const isAfterHours = hour >= 20 || hour <= 6;
    const roomPower = roomDevices.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
    
    if (isAfterHours && roomPower > 0) score -= 20;
    if (roomPower > 100) score -= 10;
    return Math.max(0, score);
  };

  const toggleRoom = (roomName) => {
    setExpandedRooms(prev => ({...prev, [roomName]: !prev[roomName]}));
  };

  const roomNames = Object.keys(rooms);
  const overallEfficiency = roomNames.length > 0 
    ? Math.round(roomNames.reduce((acc, r) => acc + calculateEfficiency(rooms[r]), 0) / roomNames.length)
    : 100;

  const costToday = ((totalPower / 1000) * 10 * 8).toFixed(2);

  const renderRoomCards = () => (
    <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-3 pb-2">
      {roomNames.map(roomName => {
        const roomDevices = rooms[roomName];
        const activeCount = roomDevices.filter(d => d.isOn).length;
        const roomWatts = roomDevices.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
        const efficiency = calculateEfficiency(roomDevices);
        const isExpanded = expandedRooms[roomName];

        return (
          <div key={roomName} className="bg-surface-50 border border-border-50 rounded-lg overflow-hidden shrink-0 transition-all duration-150">
            <button 
              onClick={() => toggleRoom(roomName)}
              className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-surface-100 transition-colors duration-150"
            >
              <div>
                <h3 className="text-base font-semibold text-white">{roomName}</h3>
                <p className="text-xs text-neutral-400 mt-1">
                  {activeCount} active devices • {roomWatts}W consumption • {efficiency}% efficiency
                </p>
              </div>
              <svg className={`w-5 h-5 text-neutral-500 transform transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {isExpanded && (
              <div className="px-5 pb-4 pt-2 border-t border-border-50 bg-background">
                <div className="flex flex-col gap-3 mt-3">
                  {roomDevices.map(dev => (
                    <div key={dev.id} className="flex justify-between items-center">
                      <span className="text-sm font-medium text-neutral-300">{dev.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-neutral-500">{dev.isOn ? 'Active' : 'Idle'}</span>
                        <div className={`w-2 h-2 rounded-full ${dev.isOn ? 'bg-status-active' : 'bg-status-idle'}`}></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderGraph = () => (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={history} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
        <CartesianGrid stroke="#262626" vertical={false} />
        <XAxis dataKey="time" hide />
        <YAxis stroke="#6B7280" fontSize={12} axisLine={false} tickLine={false} />
        <Tooltip 
          contentStyle={{ backgroundColor: '#111111', borderColor: '#333333', color: '#fff', fontSize: '12px', borderRadius: '6px' }}
          itemStyle={{ color: '#3B82F6' }}
          labelStyle={{ color: '#6B7280', marginBottom: '4px' }}
        />
        <Line 
          type="monotone" 
          dataKey="watts" 
          stroke="#3B82F6" 
          strokeWidth={2} 
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );

  const renderAlerts = () => (
    <div className="flex flex-col gap-2">
      {alerts.map(a => {
        const cleanMsg = a.msg.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '').trim();
        const isCritical = cleanMsg.toLowerCase().includes('spike');
        const isWarning = cleanMsg.toLowerCase().includes('vampire');
        
        let borderColor = 'border-border-100';
        let dotColor = 'bg-status-idle';

        if (isCritical) {
          borderColor = 'border-l-status-critical';
          dotColor = 'bg-status-critical';
        } else if (isWarning) {
          borderColor = 'border-l-status-warning';
          dotColor = 'bg-status-warning';
        }

        return (
          <div key={a.id} className={`bg-background border border-border-50 rounded p-3 pl-4 border-l-2 ${borderColor} flex items-start gap-3`}>
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dotColor}`}></div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-neutral-200">{cleanMsg}</span>
              <span className="text-[10px] text-neutral-500 mt-0.5">{a.time}</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="h-screen w-full flex flex-col bg-background overflow-hidden text-neutral-300 font-sans">
      {/* Top Navigation */}
      <nav className="border-b border-border-50 bg-background shrink-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <span className="text-white font-semibold tracking-tight text-lg">OfficeIQ</span>
            <div className="hidden md:flex space-x-6 text-sm font-medium">
              {tabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`transition-colors duration-150 ${activeTab === tab ? 'text-white' : 'text-neutral-500 hover:text-white'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center space-x-2 text-xs font-medium text-neutral-400 bg-surface-50 px-3 py-1.5 rounded-full border border-border-50">
            <div className="w-2 h-2 rounded-full bg-status-active"></div>
            <span>Live Status • Connected</span>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 flex flex-col gap-4 overflow-hidden">
        
        {/* Metrics Row (Always visible) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
          <div className="bg-surface-50 border border-border-50 rounded-lg p-4 flex flex-col justify-between">
            <span className="text-sm font-medium text-neutral-400">Total Usage</span>
            <span className="text-[32px] leading-tight font-semibold tracking-tight text-white mt-1">{totalPower}W</span>
          </div>
          <div className="bg-surface-50 border border-border-50 rounded-lg p-4 flex flex-col justify-between">
            <span className="text-sm font-medium text-neutral-400">Today's Cost</span>
            <span className="text-[32px] leading-tight font-semibold tracking-tight text-white mt-1">৳{costToday}</span>
          </div>
          <div className="bg-surface-50 border border-border-50 rounded-lg p-4 flex flex-col justify-between">
            <span className="text-sm font-medium text-neutral-400">Efficiency</span>
            <span className="text-[32px] leading-tight font-semibold tracking-tight text-white mt-1">{overallEfficiency}%</span>
          </div>
          <div className="bg-surface-50 border border-border-50 rounded-lg p-4 flex flex-col justify-between">
            <span className="text-sm font-medium text-neutral-400">Connected Devices</span>
            <span className="text-[32px] leading-tight font-semibold tracking-tight text-white mt-1">{devices.length}</span>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'Overview' && (
          <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
            {/* Left Column: Room Cards */}
            <div className="w-full lg:w-[50%] flex flex-col gap-3 min-h-0">
              <h2 className="text-lg font-medium text-white shrink-0">Device Overview</h2>
              {renderRoomCards()}
            </div>

            {/* Right Column: Graph & Alerts */}
            <div className="w-full lg:w-[50%] flex flex-col gap-4 min-h-0">
              <div className="flex flex-col flex-1 min-h-0">
                <h2 className="text-lg font-medium text-white mb-2 shrink-0">Power Trend</h2>
                <div className="bg-surface-50 border border-border-50 rounded-lg p-4 flex-1 min-h-[150px]">
                  {renderGraph()}
                </div>
              </div>

              <div className="flex flex-col h-1/3 min-h-[150px] shrink-0">
                <h2 className="text-lg font-medium text-white mb-2 shrink-0">Active Alerts</h2>
                <div className="flex-1 overflow-y-auto no-scrollbar bg-surface-50 border border-border-50 rounded-lg p-3">
                  {alerts.length === 0 ? (
                    <div className="text-sm text-neutral-500 h-full flex items-center justify-center">No active alerts.</div>
                  ) : renderAlerts()}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Rooms' && (
          <div className="flex flex-col flex-1 min-h-0">
            <h2 className="text-lg font-medium text-white mb-4 shrink-0">All Facility Rooms</h2>
            <div className="flex-1 overflow-y-auto no-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {roomNames.map(roomName => {
                  const roomDevices = rooms[roomName];
                  const activeCount = roomDevices.filter(d => d.isOn).length;
                  const roomWatts = roomDevices.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
                  const efficiency = calculateEfficiency(roomDevices);
                  const isExpanded = expandedRooms[roomName];

                  return (
                    <div key={roomName} className="bg-surface-50 border border-border-50 rounded-lg overflow-hidden shrink-0 transition-all duration-150 self-start">
                      <button 
                        onClick={() => toggleRoom(roomName)}
                        className="w-full text-left px-5 py-4 flex items-center justify-between hover:bg-surface-100 transition-colors duration-150"
                      >
                        <div>
                          <h3 className="text-base font-semibold text-white">{roomName}</h3>
                          <p className="text-xs text-neutral-400 mt-1">
                            {activeCount} active devices • {roomWatts}W • {efficiency}% eff
                          </p>
                        </div>
                        <svg className={`w-5 h-5 text-neutral-500 transform transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {isExpanded && (
                        <div className="px-5 pb-4 pt-2 border-t border-border-50 bg-background">
                          <div className="flex flex-col gap-3 mt-3">
                            {roomDevices.map(dev => (
                              <div key={dev.id} className="flex justify-between items-center">
                                <span className="text-sm font-medium text-neutral-300">{dev.name}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-neutral-500">{dev.isOn ? 'Active' : 'Idle'}</span>
                                  <div className={`w-2 h-2 rounded-full ${dev.isOn ? 'bg-status-active' : 'bg-status-idle'}`}></div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Analytics' && (
          <div className="flex flex-col flex-1 min-h-0">
            <h2 className="text-lg font-medium text-white mb-4 shrink-0">Detailed Analytics</h2>
            <div className="bg-surface-50 border border-border-50 rounded-lg p-6 flex-1 min-h-0">
              {renderGraph()}
            </div>
          </div>
        )}

        {activeTab === 'Alerts' && (
          <div className="flex flex-col flex-1 min-h-0">
            <h2 className="text-lg font-medium text-white mb-4 shrink-0">Security & Alerts Feed</h2>
            <div className="flex-1 overflow-y-auto no-scrollbar bg-surface-50 border border-border-50 rounded-lg p-6">
              {alerts.length === 0 ? (
                <div className="text-sm text-neutral-500 h-full flex items-center justify-center">No active alerts on the network.</div>
              ) : (
                <div className="max-w-3xl">
                  {renderAlerts()}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'Settings' && (
          <div className="flex flex-col flex-1 min-h-0 items-center justify-center border border-dashed border-border-50 rounded-lg bg-surface-50/50">
            <svg className="w-8 h-8 text-neutral-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h3 className="text-base font-medium text-white">Settings panel disabled</h3>
            <p className="text-sm text-neutral-500 mt-1">System configuration requires administrator privileges.</p>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
