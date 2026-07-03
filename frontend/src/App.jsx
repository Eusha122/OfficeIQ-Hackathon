import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { 
  Home, 
  LayoutDashboard, 
  BarChart3, 
  Bell, 
  Settings, 
  Zap, 
  CreditCard, 
  Target, 
  Monitor, 
  ChevronRight,
  ChevronDown,
  Fan,
  Lightbulb
} from 'lucide-react';

const socket = io('http://localhost:3001');

function App() {
  const [devices, setDevices] = useState([]);
  const [totalPower, setTotalPower] = useState(0);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [activeTab, setActiveTab] = useState('Overview');

  const tabs = [
    { name: 'Overview', icon: <Home size={18} /> },
    { name: 'Rooms', icon: <LayoutDashboard size={18} /> },
    { name: 'Analytics', icon: <BarChart3 size={18} /> },
    { name: 'Alerts', icon: <Bell size={18} /> },
    { name: 'Settings', icon: <Settings size={18} /> }
  ];

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
      setAlerts(prev => [{ id: Date.now(), msg, time: 'Just now' }, ...prev].slice(0, 5));
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

  const roomNames = Object.keys(rooms);
  const overallEfficiency = roomNames.length > 0 
    ? Math.round(roomNames.reduce((acc, r) => acc + calculateEfficiency(rooms[r]), 0) / roomNames.length)
    : 100;

  const costToday = ((totalPower / 1000) * 10 * 8).toFixed(2);

  // Tiny sparkline component for KPI cards
  const Sparkline = () => (
    <div className="w-16 h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history.slice(-10)}>
          <Line type="monotone" dataKey="watts" stroke="#1D7DFF" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="min-h-screen w-full flex bg-[#05070A] text-neutral-300 font-sans selection:bg-[#1D7DFF]/30">
      
      {/* Left Sidebar */}
      <aside className="w-[280px] h-screen border-r border-[#ffffff0f] bg-[#05070A] shrink-0 flex flex-col hidden lg:flex sticky top-0">
        <div className="p-6 flex items-center gap-3 border-b border-[#ffffff0f] h-[72px]">
          <div className="w-8 h-8 rounded-lg bg-[#1D7DFF] flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-white font-semibold tracking-tight text-lg">OfficeIQ</span>
        </div>

        <nav className="flex-1 p-4 flex flex-col gap-1 overflow-y-auto no-scrollbar">
          {tabs.map(tab => {
            const isActive = activeTab === tab.name;
            return (
              <button
                key={tab.name}
                onClick={() => setActiveTab(tab.name)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm font-medium transition-all duration-150 ${
                  isActive 
                    ? 'bg-[#1D7DFF]/10 text-[#1D7DFF]' 
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-[#ffffff0a]'
                }`}
              >
                {tab.icon}
                {tab.name}
              </button>
            );
          })}
        </nav>

        {/* User Profile Footer */}
        <div className="p-4 border-t border-[#ffffff0f]">
          <div className="flex items-center justify-between p-2 rounded-[10px] hover:bg-[#ffffff0a] cursor-pointer transition-colors duration-150">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#ffffff15] flex items-center justify-center text-xs font-semibold text-white">
                AD
              </div>
              <div className="flex flex-col items-start">
                <span className="text-sm font-medium text-white leading-tight">Admin</span>
                <span className="text-xs text-neutral-500 leading-tight">OfficeIQ</span>
              </div>
            </div>
            <ChevronDown size={14} className="text-neutral-500" />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 flex flex-col min-h-screen">
        
        {/* Top Header */}
        <header className="h-[72px] border-b border-[#ffffff0f] bg-[#05070A] flex items-center justify-between px-8 shrink-0 sticky top-0 z-20">
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold text-white tracking-tight">{activeTab}</h1>
            <p className="text-sm text-neutral-500">Real-time energy monitoring across all rooms</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 bg-[#ffffff0a] border border-[#ffffff0f] px-3 py-1.5 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00C853]"></div>
              <span className="text-[11px] font-medium text-white tracking-wide">Live Status • Connected</span>
            </div>
            <button className="text-neutral-400 hover:text-white transition-colors duration-150 relative">
              <Bell size={20} />
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#1D7DFF]"></div>
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-8">
          
          {activeTab === 'Overview' && (
            <>
              {/* KPI Cards Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                
                <div className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-5 flex flex-col justify-between hover:-translate-y-0.5 transition-transform duration-200">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-8 h-8 rounded-[8px] bg-[#1D7DFF]/10 flex items-center justify-center text-[#1D7DFF]">
                      <Zap size={16} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[36px] font-bold text-white tracking-tight leading-none mb-1">{totalPower}W</div>
                    <div className="flex justify-between items-end">
                      <span className="text-[13px] font-medium text-neutral-500">Live Consumption</span>
                      <Sparkline />
                    </div>
                  </div>
                </div>

                <div className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-5 flex flex-col justify-between hover:-translate-y-0.5 transition-transform duration-200">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-8 h-8 rounded-[8px] bg-[#1D7DFF]/10 flex items-center justify-center text-[#1D7DFF]">
                      <CreditCard size={16} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[36px] font-bold text-white tracking-tight leading-none mb-1">৳{costToday}</div>
                    <div className="flex justify-between items-end">
                      <span className="text-[13px] font-medium text-neutral-500">Estimated Cost</span>
                      <Sparkline />
                    </div>
                  </div>
                </div>

                <div className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-5 flex flex-col justify-between hover:-translate-y-0.5 transition-transform duration-200">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-8 h-8 rounded-[8px] bg-[#1D7DFF]/10 flex items-center justify-center text-[#1D7DFF]">
                      <Target size={16} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[36px] font-bold text-white tracking-tight leading-none mb-1">{overallEfficiency}%</div>
                    <div className="flex justify-between items-end">
                      <span className="text-[13px] font-medium text-neutral-500">Overall Efficiency</span>
                      <Sparkline />
                    </div>
                  </div>
                </div>

                <div className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-5 flex flex-col justify-between hover:-translate-y-0.5 transition-transform duration-200">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-8 h-8 rounded-[8px] bg-[#1D7DFF]/10 flex items-center justify-center text-[#1D7DFF]">
                      <Monitor size={16} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[36px] font-bold text-white tracking-tight leading-none mb-1">{devices.length} <span className="text-xl text-neutral-500 font-medium">/ 18</span></div>
                    <div className="flex justify-between items-end">
                      <span className="text-[13px] font-medium text-neutral-500">Connected Devices</span>
                      <Sparkline />
                    </div>
                  </div>
                </div>

              </div>

              {/* Main Content Grid: 70% Chart / 30% Alerts */}
              <div className="flex flex-col xl:flex-row gap-4 h-[400px]">
                
                {/* Power Trend Chart */}
                <div className="xl:w-[70%] bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-6 flex flex-col h-full">
                  <div className="flex justify-between items-center mb-6 shrink-0">
                    <h2 className="text-base font-semibold text-white">Power Trend (Live)</h2>
                    <div className="bg-[#ffffff0a] border border-[#ffffff0f] text-neutral-300 text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-2 cursor-pointer hover:bg-[#ffffff15] transition-colors">
                      Last 30 Minutes
                      <ChevronDown size={14} />
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 w-full ml-[-20px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="#ffffff0a" vertical={false} />
                        <XAxis 
                          dataKey="time" 
                          stroke="#6B7280" 
                          fontSize={11} 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#6B7280' }}
                          dy={10}
                        />
                        <YAxis 
                          stroke="#6B7280" 
                          fontSize={11} 
                          axisLine={false} 
                          tickLine={false} 
                          tickFormatter={(val) => `${val}W`}
                          dx={-10}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#0B1118', borderColor: '#ffffff0f', color: '#fff', fontSize: '12px', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)' }}
                          itemStyle={{ color: '#1D7DFF' }}
                          labelStyle={{ color: '#6B7280', marginBottom: '4px' }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="watts" 
                          stroke="#1D7DFF" 
                          strokeWidth={2} 
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Alerts Panel */}
                <div className="xl:w-[30%] bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-6 flex flex-col h-full">
                  <div className="flex justify-between items-center mb-6 shrink-0">
                    <h2 className="text-base font-semibold text-white">Active Alerts</h2>
                    <span className="text-[#1D7DFF] text-xs font-medium cursor-pointer hover:underline">View All</span>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar">
                    {alerts.length === 0 ? (
                      <div className="text-sm text-neutral-500 h-full flex items-center justify-center">System operating normally.</div>
                    ) : (
                      <div className="flex flex-col gap-5">
                        {alerts.map(a => {
                          const cleanMsg = a.msg.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '').trim();
                          const isCritical = cleanMsg.toLowerCase().includes('spike');
                          const isWarning = cleanMsg.toLowerCase().includes('vampire');
                          
                          let dotColor = 'bg-[#1D7DFF]'; // Default info/blue
                          if (isCritical) dotColor = 'bg-[#FF5252]'; // Danger
                          if (isWarning) dotColor = 'bg-[#FFB020]'; // Warning

                          return (
                            <div key={a.id} className="flex items-start gap-3">
                              <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dotColor}`}></div>
                              <div className="flex flex-col gap-1">
                                <span className="text-[13px] font-semibold text-neutral-200 leading-tight">{
                                  isCritical ? 'High Power Usage' : isWarning ? 'After-Hours Activity' : 'System Notice'
                                }</span>
                                <span className="text-[12px] text-neutral-400 leading-snug">{cleanMsg}</span>
                                <span className="text-[11px] text-neutral-500 mt-1">{a.time}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* Room Cards Section */}
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center mb-2">
                  <h2 className="text-base font-semibold text-white">Rooms</h2>
                  <span className="text-[#1D7DFF] text-xs font-medium cursor-pointer hover:underline">View All Rooms</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {roomNames.map(roomName => {
                    const roomDevices = rooms[roomName];
                    const activeCount = roomDevices.filter(d => d.isOn).length;
                    const roomWatts = roomDevices.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
                    const efficiency = calculateEfficiency(roomDevices);

                    return (
                      <div key={roomName} className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-6 flex flex-col justify-between h-[180px] hover:-translate-y-0.5 transition-transform duration-200">
                        <div className="flex justify-between items-start">
                          <h3 className="text-[15px] font-semibold text-white">{roomName}</h3>
                          <div className="bg-[#00C853]/10 text-[#00C853] border border-[#00C853]/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#00C853]"></div>
                            <span className="text-[10px] font-bold tracking-wide uppercase">Active</span>
                          </div>
                        </div>

                        <div className="flex justify-between items-end">
                          <div className="flex gap-8">
                            <div className="flex flex-col gap-1">
                              <span className="text-2xl font-bold text-white tracking-tight leading-none">{roomWatts}W</span>
                              <span className="text-[11px] text-neutral-500 font-medium">Current Usage</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-2xl font-bold text-white tracking-tight leading-none">{efficiency}%</span>
                              <span className="text-[11px] text-neutral-500 font-medium">Efficiency</span>
                            </div>
                          </div>
                          
                          <div className="w-16 h-8">
                             <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={history.slice(-15)}>
                                  <Line type="monotone" dataKey="watts" stroke="#00C853" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                </LineChart>
                              </ResponsiveContainer>
                          </div>
                        </div>

                        <div className="flex justify-between items-center mt-6 pt-4 border-t border-[#ffffff0f]">
                          <span className="text-[13px] text-neutral-400 font-medium">{activeCount} / {roomDevices.length} <span className="text-neutral-500 font-normal">Active Devices</span></span>
                          <button className="bg-[#ffffff05] hover:bg-[#ffffff0a] border border-[#ffffff0f] text-neutral-300 text-[11px] font-medium px-3 py-1.5 rounded-[6px] flex items-center gap-1 transition-colors">
                            View Details
                            <ChevronRight size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {activeTab === 'Rooms' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 h-full">
              {roomNames.map(roomName => {
                const roomDevices = rooms[roomName];
                const activeCount = roomDevices.filter(d => d.isOn).length;
                const roomWatts = roomDevices.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
                const efficiency = calculateEfficiency(roomDevices);

                return (
                  <div key={roomName} className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-6 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-6 shrink-0">
                      <div>
                        <h3 className="text-[16px] font-semibold text-white">{roomName}</h3>
                        <span className="text-[12px] text-neutral-500 font-medium">{activeCount} of {roomDevices.length} devices active</span>
                      </div>
                      <div className="bg-[#00C853]/10 text-[#00C853] border border-[#00C853]/20 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#00C853]"></div>
                        <span className="text-[10px] font-bold tracking-wide uppercase">Active</span>
                      </div>
                    </div>

                    <div className="flex gap-8 mb-6 shrink-0">
                      <div className="flex flex-col gap-1">
                        <span className="text-2xl font-bold text-white tracking-tight leading-none">{roomWatts}W</span>
                        <span className="text-[11px] text-neutral-500 font-medium">Current Usage</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-2xl font-bold text-white tracking-tight leading-none">{efficiency}%</span>
                        <span className="text-[11px] text-neutral-500 font-medium">Efficiency</span>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto no-scrollbar">
                      <div className="flex flex-col gap-2">
                        {roomDevices.map(dev => (
                          <div key={dev.id} className="flex justify-between items-center p-3 rounded-lg bg-[#ffffff05] border border-[#ffffff0f] hover:border-[#ffffff20] transition-colors">
                            <div className="flex items-center gap-3">
                              {dev.type === 'Fan' ? (
                                <Fan size={16} className={dev.isOn ? 'text-[#00C853] animate-[spin_2s_linear_infinite]' : 'text-neutral-600'} />
                              ) : (
                                <Lightbulb size={16} className={dev.isOn ? 'text-[#FFB020]' : 'text-neutral-600'} />
                              )}
                              <span className="text-[13px] font-medium text-neutral-300">{dev.name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500">{dev.isOn ? 'ON' : 'OFF'}</span>
                              <div className={`w-2 h-2 rounded-full ${dev.isOn ? 'bg-[#00C853] shadow-[0_0_8px_rgba(0,200,83,0.4)] animate-pulse' : 'bg-[#ffffff20]'}`}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'Analytics' && (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-5">
                  <span className="text-[12px] text-neutral-500 font-medium block mb-1">Peak Usage (Today)</span>
                  <span className="text-[24px] font-bold text-white">412W</span>
                </div>
                <div className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-5">
                  <span className="text-[12px] text-neutral-500 font-medium block mb-1">Average Efficiency</span>
                  <span className="text-[24px] font-bold text-white">{overallEfficiency}%</span>
                </div>
                <div className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-5">
                  <span className="text-[12px] text-neutral-500 font-medium block mb-1">Est. Monthly Cost</span>
                  <span className="text-[24px] font-bold text-white">৳{(costToday * 30).toFixed(2)}</span>
                </div>
              </div>
              <div className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-6 h-[500px] flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-[15px] font-semibold text-white">Detailed Power Analytics</h2>
                  <div className="bg-[#ffffff0a] border border-[#ffffff0f] text-neutral-300 text-xs font-medium px-3 py-1.5 rounded-md">Last 24 Hours</div>
                </div>
                <div className="flex-1 w-full ml-[-20px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#ffffff0a" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="time" stroke="#6B7280" fontSize={11} axisLine={false} tickLine={false} dy={10} />
                      <YAxis stroke="#6B7280" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(val) => `${val}W`} dx={-10} />
                      <Tooltip contentStyle={{ backgroundColor: '#0B1118', borderColor: '#ffffff0f', color: '#fff', fontSize: '12px', borderRadius: '8px' }} itemStyle={{ color: '#1D7DFF' }} labelStyle={{ color: '#6B7280', marginBottom: '4px' }} />
                      <Line type="monotone" dataKey="watts" stroke="#1D7DFF" strokeWidth={2} dot={{ r: 2, fill: '#1D7DFF', strokeWidth: 0 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Alerts' && (
            <div className="bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-6 max-w-3xl">
              <h2 className="text-[15px] font-semibold text-white mb-6">Security & System Alerts Log</h2>
              {alerts.length === 0 ? (
                <div className="text-sm text-neutral-500 py-12 text-center border border-dashed border-[#ffffff0f] rounded-[8px]">No alerts in the system log.</div>
              ) : (
                <div className="flex flex-col gap-4">
                  {alerts.map(a => {
                    const cleanMsg = a.msg.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '').trim();
                    const isCritical = cleanMsg.toLowerCase().includes('spike');
                    const isWarning = cleanMsg.toLowerCase().includes('vampire');
                    let dotColor = 'bg-[#1D7DFF]';
                    if (isCritical) dotColor = 'bg-[#FF5252]';
                    if (isWarning) dotColor = 'bg-[#FFB020]';

                    return (
                      <div key={a.id} className="flex items-start gap-4 p-4 border border-[#ffffff0f] bg-[#ffffff02] rounded-[8px]">
                        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`}></div>
                        <div className="flex flex-col gap-1 w-full">
                          <div className="flex justify-between items-start">
                            <span className="text-[14px] font-semibold text-neutral-200">{isCritical ? 'High Power Usage' : isWarning ? 'After-Hours Activity' : 'System Notice'}</span>
                            <span className="text-[11px] text-neutral-500">{a.time}</span>
                          </div>
                          <span className="text-[13px] text-neutral-400">{cleanMsg}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'Settings' && (
            <div className="max-w-2xl bg-[#0B1118] border border-[#ffffff0f] rounded-[12px] p-6">
              <h2 className="text-[15px] font-semibold text-white mb-6">System Configuration</h2>
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-medium text-neutral-400 uppercase tracking-wider">Organization Name</label>
                  <input type="text" disabled value="OfficeIQ Headquarters" className="bg-[#ffffff05] border border-[#ffffff0f] rounded-[8px] px-4 py-2.5 text-[14px] text-neutral-300" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-medium text-neutral-400 uppercase tracking-wider">Gateway IP Address</label>
                  <input type="text" disabled value="192.168.1.104" className="bg-[#ffffff05] border border-[#ffffff0f] rounded-[8px] px-4 py-2.5 text-[14px] text-neutral-300 font-mono" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-medium text-neutral-400 uppercase tracking-wider">Firmware Version</label>
                  <input type="text" disabled value="v2.4.1 (Stable - Managed by IT)" className="bg-[#ffffff05] border border-[#ffffff0f] rounded-[8px] px-4 py-2.5 text-[14px] text-neutral-300" />
                </div>
                <div className="pt-4 border-t border-[#ffffff0f]">
                  <button disabled className="bg-[#1D7DFF]/50 text-white/50 text-[13px] font-medium px-4 py-2 rounded-[8px] cursor-not-allowed">
                    Save Changes (Requires Admin)
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default App;
