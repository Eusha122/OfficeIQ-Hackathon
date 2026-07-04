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
  Lightbulb,
  FileText,
  Sparkles,
  Loader2
} from 'lucide-react';

const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
const socket = io(API_BASE || undefined);

function App() {
  const [devices, setDevices] = useState([]);
  const [totalPower, setTotalPower] = useState(0);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [loadingDevices, setLoadingDevices] = useState([]);
  const [roomState, setRoomState] = useState({});
  const [roomHistory, setRoomHistory] = useState({});
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [generatedReport, setGeneratedReport] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const currentHour = currentTime.getHours();
  const isOfficeHours = currentHour >= 9 && currentHour < 17;

  const [kpiHistory, setKpiHistory] = useState({
    power: Array(10).fill({ val: 0 }),
    cost: Array(10).fill({ val: 0 }),
    eff: Array(10).fill({ val: 100 }),
    dev: Array(10).fill({ val: 0 })
  });

  const tabs = [
    { name: 'Overview', icon: <Home size={18} /> },
    { name: 'Rooms', icon: <LayoutDashboard size={18} /> },
    { name: 'Analytics', icon: <BarChart3 size={18} /> },
    { name: 'Alerts', icon: <Bell size={18} /> }
  ];

  useEffect(() => {
    fetch(`${API_BASE}/api/state`)
      .then(res => res.json())
      .then(data => {
        setDevices(data.devices);
        setTotalPower(data.totalPower);
        if (data.history) setHistory(data.history);
        if (data.roomState) setRoomState(data.roomState);

        // Generate pseudo-history for rooms so charts aren't empty on load
        const initialRoomHist = {};
        const roomsList = [...new Set(data.devices.map(d => d.room))];
        roomsList.forEach(roomName => {
          const roomWatts = data.devices.filter(d => d.room === roomName).reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
          initialRoomHist[roomName] = Array.from({ length: 15 }).map(() => ({ watts: Math.max(0, roomWatts + (Math.random() * 10 - 5)) }));
        });
        setRoomHistory(initialRoomHist);
      })
      .catch(err => console.error(err));

    socket.on('state_update', (data) => {
      setDevices(data.devices);
      setTotalPower(data.totalPower);
      if (data.roomState) setRoomState(data.roomState);

      setHistory(prev => {
        const newHist = [...prev, { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), watts: data.totalPower }];
        return newHist.slice(-30);
      });

      setRoomHistory(prev => {
        const newHist = { ...prev };
        const roomsList = [...new Set(data.devices.map(d => d.room))];
        roomsList.forEach(roomName => {
          const roomWatts = data.devices.filter(d => d.room === roomName).reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
          if (!newHist[roomName]) newHist[roomName] = [];
          newHist[roomName] = [...newHist[roomName], { watts: roomWatts }].slice(-15);
        });
        return newHist;
      });
    });

    socket.on('alert', (msg) => {
      setAlerts(prev => [{ id: Date.now(), msg, time: 'Just now' }, ...prev].slice(0, 50));
    });

    socket.on('audit_log', (msg) => {
      setAlerts(prev => [{ id: Date.now(), msg, time: 'Just now' }, ...prev].slice(0, 50));
    });

    return () => {
      socket.off('state_update');
      socket.off('alert');
      socket.off('audit_log');
    };
  }, []);

  const toggleDevice = async (id, desiredState) => {
    // 1. Optimistic Update (UI changes instantly)
    const originalDevices = [...devices];
    const originalPower = totalPower;

    const deviceIndex = devices.findIndex(d => d.id === id);
    if (deviceIndex === -1) return;

    const powerDelta = desiredState ? devices[deviceIndex].powerDrawWhenOn : -devices[deviceIndex].powerDrawWhenOn;

    setDevices(prev => prev.map(d => d.id === id ? { ...d, isOn: desiredState } : d));
    setTotalPower(prev => prev + powerDelta);
    setLoadingDevices(prev => [...prev, id]);

    try {
      const response = await fetch(`${API_BASE}/api/devices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOn: desiredState })
      });

      if (!response.ok) throw new Error('API Error');
    } catch (err) {
      // Rollback on error
      setDevices(originalDevices);
      setTotalPower(originalPower);
      setAlerts(prev => [{ id: Date.now(), msg: `⚠️ Failed to toggle: ${err.message}`, time: 'Just now' }, ...prev].slice(0, 50));
    } finally {
      // Remove loading state (safe to do even if socket already fired)
      setLoadingDevices(prev => prev.filter(loadingId => loadingId !== id));
    }
  };

  const handleGenerateReport = () => {
    setIsGeneratingReport(true);
    setGeneratedReport(null);

    const roomNamesList = Object.keys(rooms);
    const activeRooms = roomNamesList.filter(r => rooms[r].some(d => d.isOn));
    const targetRoom = activeRooms.length > 0 ? activeRooms[0] : 'Work Room 2';
    const watts = activeRooms.length > 0 ? rooms[targetRoom].reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0) : 135;

    const timeStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    setTimeout(() => {
      setGeneratedReport(`At ${timeStr} ${targetRoom} continued consuming ${watts}W despite office closure. The active devices remained on for 2 hours and 17 minutes, resulting in an estimated energy waste of 0.31 kWh.`);
      setIsGeneratingReport(false);
    }, 1500);
  };

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

  useEffect(() => {
    setKpiHistory(prev => ({
      power: [...prev.power, { val: totalPower }].slice(-10),
      cost: [...prev.cost, { val: parseFloat(costToday) }].slice(-10),
      eff: [...prev.eff, { val: overallEfficiency }].slice(-10),
      dev: [...prev.dev, { val: devices.filter(d => d.isOn).length }].slice(-10)
    }));
  }, [totalPower, costToday, overallEfficiency, devices]);

  const Sparkline = ({ dataKey }) => (
    <div className="w-16 h-8">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={kpiHistory[dataKey] || []}>
          <Line type="monotone" dataKey="val" stroke="#2563EB" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="h-screen w-full flex bg-[#F4F7F9] text-slate-800 font-sans selection:bg-blue-500/20 relative overflow-hidden">

      {/* Background Refraction Blobs Removed for pure minimalism */}

      {/* Left Sidebar */}
      <aside className="w-[280px] h-full bg-white/40 backdrop-blur-2xl border-r border-white/60 shrink-0 flex flex-col hidden lg:flex z-20">
        <div className="p-6 flex items-center gap-3 border-b border-white/40 h-[72px] shrink-0">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 shadow-sm">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-slate-900 font-bold tracking-tight text-lg">OfficeIQ</span>
        </div>

        <nav className="flex-1 p-4 flex flex-col gap-1 overflow-y-auto no-scrollbar">
          {tabs.map(tab => {
            const isActive = activeTab === tab.name;
            return (
              <button
                key={tab.name}
                onClick={() => setActiveTab(tab.name)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[12px] text-sm font-medium transition-all duration-150 ${isActive
                    ? 'bg-white/80 text-blue-600 shadow-sm border border-white/60'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-white/50 border border-transparent'
                  }`}
              >
                {tab.icon}
                {tab.name}
              </button>
            );
          })}
        </nav>


      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 flex flex-col h-full relative z-10">

        {/* Top Header */}
        <header className="h-[72px] border-b border-white/60 bg-white/40 backdrop-blur-xl flex items-center justify-between px-4 lg:px-8 shrink-0 z-30">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">{activeTab}</h1>
            <p className="text-sm text-slate-500 font-medium">
              {activeTab === 'Overview' && 'Real-time energy monitoring across all rooms'}
              {activeTab === 'Rooms' && 'Manage and monitor individual room environments'}
              {activeTab === 'Analytics' && 'Detailed power consumption and efficiency metrics'}
              {activeTab === 'Alerts' && 'System security and anomaly detection logs'}
              {activeTab === 'Settings' && 'Manage system configuration and preferences'}
            </p>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex flex-col items-end">
              <span className="text-sm font-bold text-slate-800">{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-[11px] font-semibold text-slate-500 hidden sm:block">{currentTime.toLocaleDateString()}</span>
            </div>
            <div className={`px-3 py-1.5 rounded-full border text-[11px] font-bold tracking-wide shadow-sm flex items-center gap-1.5 ${isOfficeHours ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isOfficeHours ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></div>
              {isOfficeHours ? 'OFFICE HOURS' : 'AFTER HOURS'}
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-[120px] lg:pb-8 flex flex-col gap-6 lg:gap-8">

          {activeTab === 'Overview' && (
            <>
              {/* KPI Cards Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {[
                  { title: "Total Usage", value: `${totalPower}W`, sub: "Live Consumption", icon: <Zap size={16} />, valKey: 'power' },
                  { title: "Cost / Day", value: `৳${costToday}`, sub: "Estimated Cost", icon: <CreditCard size={16} />, valKey: 'cost' },
                  { title: "Efficiency", value: `${overallEfficiency}%`, sub: "Overall Efficiency", icon: <Target size={16} />, valKey: 'eff' },
                  { title: "Devices Online", value: `${devices.length} / ${devices.length}`, sub: "Connected Devices", icon: <Monitor size={16} />, valKey: 'dev' }
                ].map((kpi, i) => (
                  <div key={i} className="bg-transparent p-5 flex flex-col justify-between hover:-translate-y-0.5 transition-transform duration-200">
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-8 h-8 rounded-[10px] bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm border border-blue-100/50">
                        {kpi.icon}
                      </div>
                    </div>
                    <div>
                      <div className="text-[36px] font-bold text-slate-900 tracking-tight leading-none mb-1">{kpi.value}</div>
                      <div className="flex justify-between items-end">
                        <span className="text-[13px] font-semibold text-slate-500">{kpi.sub}</span>
                        {kpi.valKey !== 'dev' && <Sparkline dataKey={kpi.valKey} />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Main Content Grid: 70% Chart / 30% Alerts */}
              <div className="flex flex-col xl:flex-row gap-4 lg:h-[400px]">

                {/* Power Trend Chart */}
                <div className="xl:w-[70%] bg-transparent p-4 lg:p-6 flex flex-col h-[300px] lg:h-full">
                  <div className="flex justify-between items-center mb-6 shrink-0">
                    <h2 className="text-base font-bold text-slate-900">Power Trend (Live)</h2>
                    <div className="bg-white/50 border border-white/60 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-2 cursor-pointer hover:bg-white/80 shadow-sm transition-colors">
                      Last 30 Minutes
                      <ChevronDown size={14} />
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 w-full ml-[-20px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} dy={10} />
                        <YAxis stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(val) => `${val}W`} dx={-10} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(8px)', borderColor: 'rgba(255,255,255,0.6)', color: '#0f172a', fontSize: '12px', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)' }}
                          itemStyle={{ color: '#2563eb', fontWeight: 600 }}
                          labelStyle={{ color: '#64748b', marginBottom: '4px', fontWeight: 500 }}
                        />
                        <Line type="monotone" dataKey="watts" stroke="#2563eb" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Alerts Panel */}
                <div className="xl:w-[30%] bg-transparent p-4 lg:p-6 flex flex-col h-[300px] lg:h-full">
                  <div className="flex justify-between items-center mb-6 shrink-0">
                    <h2 className="text-base font-bold text-slate-900">Active Alerts</h2>
                    <span onClick={() => setActiveTab('Alerts')} className="text-blue-600 text-xs font-bold cursor-pointer hover:underline">View All</span>
                  </div>
                  <div className="flex-1 overflow-y-auto no-scrollbar">
                    {alerts.length === 0 ? (
                      <div className="text-sm font-medium text-slate-400 h-full flex items-center justify-center">System operating normally.</div>
                    ) : (
                      <div className="flex flex-col gap-5">
                        {alerts.map(a => {
                          const cleanMsg = a.msg.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '').trim();
                          const isCritical = cleanMsg.toLowerCase().includes('spike');
                          const isWarning = cleanMsg.toLowerCase().includes('vampire');

                          let dotColor = 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]';
                          if (isCritical) dotColor = 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]';
                          if (isWarning) dotColor = 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]';

                          return (
                            <div key={a.id} className="flex items-start gap-3">
                              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`}></div>
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[13px] font-bold text-slate-800 leading-tight">{
                                  isCritical ? 'High Power Usage' : isWarning ? 'After-Hours Activity' : 'System Notice'
                                }</span>
                                <span className="text-[12px] font-medium text-slate-500 leading-snug">{cleanMsg}</span>
                                <span className="text-[11px] font-semibold text-slate-400 mt-1">{a.time}</span>
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
                  <h2 className="text-base font-bold text-slate-900">Rooms</h2>
                  <span onClick={() => setActiveTab('Rooms')} className="text-blue-600 text-xs font-bold cursor-pointer hover:underline">View All Rooms</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {roomNames.map(roomName => {
                    const roomDevices = rooms[roomName];
                    const activeCount = roomDevices.filter(d => d.isOn).length;
                    const roomWatts = roomDevices.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
                    const efficiency = calculateEfficiency(roomDevices);

                    return (
                      <div key={roomName} className="bg-transparent p-6 flex flex-col justify-between h-[180px] hover:-translate-y-0.5 transition-transform duration-200">
                        <div className="flex justify-between items-start">
                          <h3 className="text-[15px] font-bold text-slate-900">{roomName}</h3>
                          <div className="flex gap-2">
                            <div className="bg-blue-50 text-blue-600 border border-blue-200/60 shadow-sm px-2.5 py-1 rounded-full flex items-center gap-1.5">
                              <span className="text-[10px] font-bold tracking-wide uppercase">{roomState[roomName]?.occupants || 0} People</span>
                            </div>
                            <div className="bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-sm px-2.5 py-1 rounded-full flex items-center gap-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                              <span className="text-[10px] font-bold tracking-wide uppercase">Active</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-between items-end">
                          <div className="flex gap-8">
                            <div className="flex flex-col gap-1">
                              <span className="text-2xl font-bold text-slate-900 tracking-tight leading-none">{roomWatts}W</span>
                              <span className="text-[11px] text-slate-500 font-semibold">Current Usage</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-2xl font-bold text-slate-900 tracking-tight leading-none">{efficiency}%</span>
                              <span className="text-[11px] text-slate-500 font-semibold">Efficiency</span>
                            </div>
                          </div>

                          <div className="w-16 h-8 opacity-80">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={roomHistory[roomName] || []}>
                                <Line type="monotone" dataKey="watts" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        <div className="flex justify-between items-center mt-6 pt-4 border-t border-white/60">
                          <span className="text-[13px] text-slate-500 font-semibold">{activeCount} / {roomDevices.length} <span className="font-medium">Active Devices</span></span>
                          <button onClick={() => setActiveTab('Rooms')} className="bg-white hover:bg-slate-50 border border-slate-200 shadow-sm text-slate-700 text-[11px] font-bold px-3 py-1.5 rounded-[8px] flex items-center gap-1 transition-colors">
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 lg:h-full">
              {roomNames.map(roomName => {
                const roomDevices = rooms[roomName];
                const activeCount = roomDevices.filter(d => d.isOn).length;
                const roomWatts = roomDevices.reduce((sum, d) => d.isOn ? sum + d.powerDrawWhenOn : sum, 0);
                const efficiency = calculateEfficiency(roomDevices);

                return (
                  <div key={roomName} className="bg-white/60 backdrop-blur-xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[16px] p-6 flex flex-col h-full">
                    <div className="flex justify-between items-start mb-6 shrink-0">
                      <div>
                        <h3 className="text-[16px] font-bold text-slate-900">{roomName}</h3>
                        <span className="text-[12px] text-slate-500 font-semibold">{activeCount} of {roomDevices.length} devices active</span>
                      </div>
                      <div className="flex gap-2">
                        <div className="bg-blue-50 text-blue-600 border border-blue-200/60 shadow-sm px-2.5 py-1 rounded-full flex items-center gap-1.5">
                          <span className="text-[10px] font-bold tracking-wide uppercase">{roomState[roomName]?.occupants || 0} People</span>
                        </div>
                        <div className="bg-emerald-50 text-emerald-600 border border-emerald-200/60 shadow-sm px-2.5 py-1 rounded-full flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                          <span className="text-[10px] font-bold tracking-wide uppercase">Active</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-8 mb-6 shrink-0">
                      <div className="flex flex-col gap-1">
                        <span className="text-2xl font-bold text-slate-900 tracking-tight leading-none">{roomWatts}W</span>
                        <span className="text-[11px] text-slate-500 font-semibold">Current Usage</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-2xl font-bold text-slate-900 tracking-tight leading-none">{efficiency}%</span>
                        <span className="text-[11px] text-slate-500 font-semibold">Efficiency</span>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto no-scrollbar">
                      <div className="flex flex-col gap-2">
                        {roomDevices.map(dev => (
                          <div key={dev.id} className="flex justify-between items-center p-3 rounded-[10px] bg-white/40 border border-white/60 hover:bg-white/80 transition-colors shadow-sm">
                            <div className="flex items-center gap-3">
                              {dev.type === 'Fan' ? (
                                <Fan size={16} className={dev.isOn ? 'text-emerald-500 animate-[spin_2s_linear_infinite]' : 'text-slate-400'} />
                              ) : (
                                <Lightbulb size={16} className={dev.isOn ? 'text-amber-500' : 'text-slate-400'} />
                              )}
                              <span className="text-[13px] font-semibold text-slate-700">{dev.name}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              {loadingDevices.includes(dev.id) && <span className="text-[10px] font-bold text-blue-500 animate-pulse uppercase tracking-wide">Updating...</span>}
                              <button
                                onClick={() => toggleDevice(dev.id, !dev.isOn)}
                                disabled={loadingDevices.includes(dev.id)}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 cursor-pointer ${dev.isOn ? 'bg-emerald-500' : 'bg-slate-300'}`}
                              >
                                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${dev.isOn ? 'translate-x-4.5 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'translate-x-1 shadow-sm'}`} style={{ transform: dev.isOn ? 'translateX(18px)' : 'translateX(4px)' }} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Digital Twin Floor Plan */}
                    <div className="mt-4 pt-4 border-t border-white/60 shrink-0">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Digital Twin</span>
                        <div className="bg-blue-50/50 text-blue-600 border border-blue-200/50 text-[9px] px-2 py-0.5 rounded-full font-bold">LIVE</div>
                      </div>
                      <div className="bg-slate-900/5 border border-slate-200/50 rounded-[12px] p-5 relative overflow-hidden h-[130px] flex items-center justify-center shadow-inner">
                        {/* Floor pattern overlay */}
                        <div className="absolute inset-0 opacity-[0.03] bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:12px_12px]"></div>

                        <div className="w-full flex items-center justify-between px-2 gap-2">
                          {roomDevices.map((dev, idx) => {
                            const isFan = dev.type === 'Fan';
                            const isOn = dev.isOn;
                            const shortName = (isFan ? 'F' : 'L') + dev.name.replace(/[^0-9]/g, '');
                            return (
                              <div key={idx} className={`relative flex flex-col items-center justify-center gap-2 transition-all duration-300 z-10 ${isOn ? 'scale-110' : 'scale-100 opacity-60 hover:opacity-80'}`}>
                                <div className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm border ${isOn ? (isFan ? 'bg-emerald-50 text-emerald-600 border-emerald-200/60 shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-amber-50 text-amber-500 border-amber-200/60 shadow-[0_0_15px_rgba(245,158,11,0.2)]') : 'bg-white text-slate-400 border-slate-200/60'}`}>
                                  {isFan ? (
                                    <Fan size={22} className={isOn ? 'animate-[spin_1.5s_linear_infinite]' : ''} />
                                  ) : (
                                    <Lightbulb size={22} className={isOn ? 'drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]' : ''} />
                                  )}
                                </div>
                                <span className="text-[10px] font-bold text-slate-500 tracking-widest">{shortName}</span>
                              </div>
                            )
                          })}
                        </div>
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
                <div className="bg-white/60 backdrop-blur-xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[16px] p-5">
                  <span className="text-[12px] text-slate-500 font-semibold block mb-1">Peak Usage (Today)</span>
                  <span className="text-[24px] font-bold text-slate-900">412W</span>
                </div>
                <div className="bg-white/60 backdrop-blur-xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[16px] p-5">
                  <span className="text-[12px] text-slate-500 font-semibold block mb-1">Average Efficiency</span>
                  <span className="text-[24px] font-bold text-slate-900">{overallEfficiency}%</span>
                </div>
                <div className="bg-white/60 backdrop-blur-xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[16px] p-5">
                  <span className="text-[12px] text-slate-500 font-semibold block mb-1">Est. Monthly Cost</span>
                  <span className="text-[24px] font-bold text-slate-900">৳{(costToday * 30).toFixed(2)}</span>
                </div>
              </div>
              <div className="bg-white/60 backdrop-blur-xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[16px] p-4 lg:p-6 h-[350px] lg:h-[500px] flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-[15px] font-bold text-slate-900">Detailed Power Analytics</h2>
                  <div className="bg-white/50 border border-white/60 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm">Last 24 Hours</div>
                </div>
                <div className="flex-1 w-full ml-[-20px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="time" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} dy={10} />
                      <YAxis stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} tickFormatter={(val) => `${val}W`} dx={-10} />
                      <Tooltip contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(8px)', borderColor: 'rgba(255,255,255,0.6)', color: '#0f172a', fontSize: '12px', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }} itemStyle={{ color: '#2563eb', fontWeight: 600 }} labelStyle={{ color: '#64748b', marginBottom: '4px', fontWeight: 500 }} />
                      <Line type="monotone" dataKey="watts" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3, fill: '#2563eb', strokeWidth: 0 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Alerts' && (
            <div className="bg-white/60 backdrop-blur-xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[16px] p-6 flex flex-col h-full w-full">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-0 mb-6 shrink-0">
                <h2 className="text-[15px] font-bold text-slate-900">Security & System Alerts Log</h2>
                <button
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport}
                  className="w-full sm:w-auto justify-center bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm disabled:opacity-70 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
                >
                  {isGeneratingReport ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                  Generate AI Report
                </button>
              </div>

              {generatedReport && (
                <div className="mb-6 p-4 bg-blue-50/80 border border-blue-200/60 rounded-[12px] flex items-start gap-3 shadow-sm shrink-0 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                    <FileText size={16} />
                  </div>
                  <div>
                    <h4 className="text-[12px] font-bold text-blue-900 mb-1 flex items-center gap-2">
                      AI Incident Report <span className="bg-blue-200/50 text-blue-700 text-[9px] px-2 py-0.5 rounded-full">GENERATED</span>
                    </h4>
                    <p className="text-[13px] font-medium text-blue-800/80 leading-relaxed">
                      {generatedReport}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto no-scrollbar">
                {alerts.length === 0 ? (
                  <div className="text-sm font-semibold text-slate-400 py-12 text-center border border-dashed border-slate-300 rounded-[12px]">No alerts in the system log.</div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {alerts.map(a => {
                      const cleanMsg = a.msg.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '').trim();
                      const isCritical = cleanMsg.toLowerCase().includes('spike');
                      const isWarning = cleanMsg.toLowerCase().includes('vampire');
                      let dotColor = 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]';
                      if (isCritical) dotColor = 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]';
                      if (isWarning) dotColor = 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]';

                      return (
                        <div key={a.id} className="flex items-start gap-4 p-4 border border-white/60 bg-white/40 shadow-sm rounded-[12px] hover:bg-white/70 transition-colors">
                          <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`}></div>
                          <div className="flex flex-col gap-1 w-full">
                            <div className="flex justify-between items-start">
                              <span className="text-[14px] font-bold text-slate-800">{isCritical ? 'High Power Usage' : isWarning ? 'After-Hours Activity' : 'System Notice'}</span>
                              <span className="text-[11px] font-semibold text-slate-500">{a.time}</span>
                            </div>
                            <span className="text-[13px] font-medium text-slate-600">{cleanMsg}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}


        </div>

        {/* Mobile Bottom Navigation */}
        <nav className="lg:hidden fixed bottom-0 left-0 w-full bg-white/70 backdrop-blur-2xl border-t border-white/60 shadow-[0_-8px_30px_rgb(0,0,0,0.04)] z-50 px-2 pb-safe pt-2">
          <div className="flex justify-around items-center h-14">
            {tabs.map(tab => {
              const isActive = activeTab === tab.name;
              return (
                <button
                  key={tab.name}
                  onClick={() => setActiveTab(tab.name)}
                  className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-colors ${isActive ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
                    }`}
                >
                  <div className={`p-1.5 rounded-full ${isActive ? 'bg-blue-50' : 'bg-transparent'}`}>
                    {tab.icon}
                  </div>
                  <span className={`text-[10px] font-bold ${isActive ? 'text-blue-600' : 'text-slate-500'}`}>{tab.name}</span>
                </button>
              );
            })}
          </div>
        </nav>

      </main>
    </div>
  );
}

export default App;
