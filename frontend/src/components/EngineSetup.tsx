import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, Map as MapIcon, RotateCcw, AlertTriangle, Maximize, Minimize } from 'lucide-react';
import { AreaChart, Area, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, YAxis } from 'recharts';

const US_STATES = [
    { id: 'alabama', name: 'Alabama' },
    { id: 'alaska', name: 'Alaska' },
    { id: 'arizona', name: 'Arizona' },
    { id: 'arkansas', name: 'Arkansas' },
    { id: 'california', name: 'California' },
    { id: 'colorado', name: 'Colorado' },
    { id: 'connecticut', name: 'Connecticut' },
    { id: 'delaware', name: 'Delaware' },
    { id: 'district-of-columbia', name: 'District of Columbia' },
    { id: 'florida', name: 'Florida' },
    { id: 'georgia', name: 'Georgia' },
    { id: 'hawaii', name: 'Hawaii' },
    { id: 'idaho', name: 'Idaho' },
    { id: 'illinois', name: 'Illinois' },
    { id: 'indiana', name: 'Indiana' },
    { id: 'iowa', name: 'Iowa' },
    { id: 'kansas', name: 'Kansas' },
    { id: 'kentucky', name: 'Kentucky' },
    { id: 'louisiana', name: 'Louisiana' },
    { id: 'maine', name: 'Maine' },
    { id: 'maryland', name: 'Maryland' },
    { id: 'massachusetts', name: 'Massachusetts' },
    { id: 'michigan', name: 'Michigan' },
    { id: 'minnesota', name: 'Minnesota' },
    { id: 'mississippi', name: 'Mississippi' },
    { id: 'missouri', name: 'Missouri' },
    { id: 'montana', name: 'Montana' },
    { id: 'nebraska', name: 'Nebraska' },
    { id: 'nevada', name: 'Nevada' },
    { id: 'new-hampshire', name: 'New Hampshire' },
    { id: 'new-jersey', name: 'New Jersey' },
    { id: 'new-mexico', name: 'New Mexico' },
    { id: 'new-york', name: 'New York' },
    { id: 'north-carolina', name: 'North Carolina' },
    { id: 'north-dakota', name: 'North Dakota' },
    { id: 'ohio', name: 'Ohio' },
    { id: 'oklahoma', name: 'Oklahoma' },
    { id: 'oregon', name: 'Oregon' },
    { id: 'pennsylvania', name: 'Pennsylvania' },
    { id: 'puerto-rico', name: 'Puerto Rico' },
    { id: 'rhode-island', name: 'Rhode Island' },
    { id: 'south-carolina', name: 'South Carolina' },
    { id: 'south-dakota', name: 'South Dakota' },
    { id: 'tennessee', name: 'Tennessee' },
    { id: 'texas', name: 'Texas' },
    { id: 'us-virgin-islands', name: 'United States Virgin Islands' },
    { id: 'utah', name: 'Utah' },
    { id: 'vermont', name: 'Vermont' },
    { id: 'virginia', name: 'Virginia' },
    { id: 'washington', name: 'Washington' },
    { id: 'west-virginia', name: 'West Virginia' },
    { id: 'wisconsin', name: 'Wisconsin' },
    { id: 'wyoming', name: 'Wyoming' }
];

function formatUptime(startedAt: string | null | undefined): string {
    if (!startedAt) return 'N/A';
    try {
        const start = new Date(startedAt);
        const now = new Date();
        const diffMs = Math.max(0, now.getTime() - start.getTime());
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        const diffHrs = Math.floor(diffMins / 60);
        if (diffHrs < 24) return `${diffHrs} hr${diffHrs > 1 ? 's' : ''} ago`;
        const diffDays = Math.floor(diffHrs / 24);
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } catch {
        return 'Unknown';
    }
}

const generateMockHistory = () => {
    return Array.from({ length: 30 }, (_, i) => ({
        time: i,
        cpu: Math.floor(Math.random() * 30) + 20 + (Math.sin(i / 2) * 15),
        ram: Math.floor(Math.random() * 10) + 40 + (Math.cos(i / 3) * 10),
        netIn: 0,
        netOut: 0,
        diskRead: 0,
        diskWrite: 0
    }));
};

const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec < 1024 * 1024) {
        return { value: (bytesPerSec / 1024).toFixed(1), unit: 'KB/s' };
    }
    return { value: (bytesPerSec / 1024 / 1024).toFixed(1), unit: 'MB/s' };
};

const MetricBar = ({ value, max, label, color }: { value: number, max?: number, label: string, color: string }) => {
    const pct = max ? Math.min(100, Math.max(0, (value / max) * 100)) : 100;
    return (
        <div style={{ flex: 1, height: '14px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', position: 'relative', marginLeft: '12px' }}>
            <div style={{ width: `${max ? pct : 100}%`, height: '100%', background: max ? color : 'rgba(255,255,255,0.02)', transition: 'width 0.3s ease' }}></div>
            <div style={{ position: 'absolute', top: 0, right: '4px', height: '100%', display: 'flex', alignItems: 'center', fontSize: '9px', fontWeight: 600, color: '#fff', textShadow: '0 0 2px rgba(0,0,0,0.8)' }}>
                {label}
            </div>
        </div>
    );
};

export default function EngineSetup() {
    const [metrics, setMetrics] = useState<{ cpu: number, ram: number } | null>(null);
    const [history, setHistory] = useState<any[]>(generateMockHistory());
    const [dockerStatus, setDockerStatus] = useState<{ car: string, foot: string, active_states?: string[] } | null>(null);
    const [selectedStates, setSelectedStates] = useState<string[]>([]);
    const [mergeStatus, setMergeStatus] = useState<string | null>(null);
    const [apiCalls, setApiCalls] = useState<any[]>([]);
    const [carPort, setCarPort] = useState<number>(5002);
    const [footPort, setFootPort] = useState<number>(5003);
    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [viewMode, setViewMode] = useState<'traffic' | 'deployment' | 'car_logs' | 'foot_logs'>('traffic');
    const [deployLogs, setDeployLogs] = useState<string[]>([]);
    const [carLogs, setCarLogs] = useState<string[]>([]);
    const [footLogs, setFootLogs] = useState<string[]>([]);
    const [activeStates, setActiveStates] = useState<string[]>([]);
    const [showCarLogs, setShowCarLogs] = useState(false);
    const [showFootLogs, setShowFootLogs] = useState(false);
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
    const [termInput, setTermInput] = useState('');
    const [forceDownload, setForceDownload] = useState(false);
    const [isLogFullScreen, setIsLogFullScreen] = useState(false);
    const [dockerStats, setDockerStats] = useState<any>({ car: null, foot: null });
    const logsContainerRef = useRef<HTMLDivElement>(null);
    const isScrolledToBottom = useRef(true);

    useEffect(() => {
        if (logsContainerRef.current && isScrolledToBottom.current) {
            logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
    }, [apiCalls, deployLogs, viewMode]);

    useEffect(() => {
        const fetchMetrics = async () => {
            try {
                const res = await fetch('http://localhost:8000/system/metrics');
                if (res.ok) {
                    const data = await res.json();
                    setMetrics(data);
                    setHistory(prev => {
                        const newHist = [...prev.slice(1), {
                            time: prev[prev.length - 1].time + 1,
                            cpu: data.cpu,
                            ram: data.ram,
                            netIn: data.net_in || 0,
                            netOut: data.net_out || 0,
                            diskRead: data.disk_read || 0,
                            diskWrite: data.disk_write || 0
                        }];
                        return newHist;
                    });
                }
            } catch (e) { }
        };

        const fetchDocker = async () => {
            try {
                const res = await fetch('http://localhost:8000/system/docker');
                if (res.ok) {
                    const data = await res.json();
                    setDockerStatus(data);
                    if (data.active_states && Array.isArray(data.active_states)) {
                        setActiveStates(data.active_states);
                    }
                }

                Promise.all([
                    fetch('http://localhost:8000/system/docker/car/stats').then(r => r.json()).catch(() => ({ error: true })),
                    fetch('http://localhost:8000/system/docker/foot/stats').then(r => r.json()).catch(() => ({ error: true }))
                ]).then(([carStats, footStats]) => {
                    setDockerStats({
                        car: carStats.error ? null : carStats,
                        foot: footStats.error ? null : footStats
                    });
                });
            } catch (e) { }
        };

        const fetchApiCalls = async () => {
            try {
                const res = await fetch('http://localhost:8000/system/api-calls');
                if (res.ok) {
                    const data = await res.json();
                    setApiCalls(data.calls || []);
                }
            } catch (e) { }
        };

        const fetchDeployLogs = async () => {
            try {
                const res = await fetch('http://localhost:8000/system/logs');
                if (res.ok) {
                    const data = await res.json();
                    setDeployLogs(data.logs || []);
                }
            } catch (e) { }
            try {
                const resCar = await fetch('http://localhost:8000/system/docker/car/logs');
                if (resCar.ok) {
                    const data = await resCar.json();
                    setCarLogs(data.logs || []);
                }
            } catch (e) { }
            try {
                const resFoot = await fetch('http://localhost:8000/system/docker/foot/logs');
                if (resFoot.ok) {
                    const data = await resFoot.json();
                    setFootLogs(data.logs || []);
                }
            } catch (e) { }
        };

        fetchMetrics();
        fetchDocker();
        fetchApiCalls();
        fetchDeployLogs();
        const interval = setInterval(() => {
            fetchMetrics();
            fetchDocker();
            fetchApiCalls();
            fetchDeployLogs();
        }, 2000);

        return () => clearInterval(interval);
    }, []);

    const handleRemoveAllContainers = () => {
        setShowRemoveConfirm(true);
    };

    const confirmRemoveAllContainers = async () => {
        setShowRemoveConfirm(false);
        try {
            await fetch('http://localhost:8000/system/docker/remove-all', { method: 'POST' });
        } catch (e) { }
    };

    const handleDockerAction = async (profile: string, action: 'start' | 'stop') => {
        try {
            await fetch(`http://localhost:8000/system/docker/${profile}/${action}`, { method: 'POST' });
        } catch (e) { }
    };

    const renderStats = (profile: string) => {
        const now = Date.now();
        const calls = apiCalls.filter(c => {
            if (c.profile !== profile) return false;
            let callTime = 0;
            try {
                // Parse standard format if possible
                callTime = new Date(c.timestamp).getTime();
                // If invalid date and we have a timestamp, try DD-MM-YYYY HH:MM:SS or YYYY-MM-DD HH:MM:SS
                if (isNaN(callTime) && c.timestamp) {
                    const parts = c.timestamp.split(' ');
                    if (parts.length >= 2) {
                        const dateParts = parts[0].split('-');
                        if (dateParts.length === 3) {
                            if (dateParts[0].length === 4) {
                                callTime = new Date(`${dateParts[0]}-${dateParts[1]}-${dateParts[2]}T${parts[1]}`).getTime();
                            } else {
                                callTime = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${parts[1]}`).getTime();
                            }
                        }
                    }
                }
            } catch (e) { }

            // If we still can't parse it, include it to be safe. Otherwise check 24h.
            if (!callTime || isNaN(callTime)) return true;
            return (now - callTime) <= 24 * 60 * 60 * 1000;
        });

        const hasTraffic = calls.length > 0;

        const routesToday = calls.length.toLocaleString();

        const servicesCount = calls.reduce((acc, c) => {
            const s = c.service || 'route';
            acc[s] = (acc[s] || 0) + 1;
            return acc;
        }, { route: 0, nearest: 0, table: 0, match: 0, trip: 0, tile: 0 } as Record<string, number>);

        const latencies = calls.map(c => parseFloat(c.latency) || 0).filter(l => l > 0);
        const avgResp = hasTraffic && latencies.length > 0 ? Math.round(latencies.reduce((sum, l) => sum + l, 0) / latencies.length) + ' ms' : '0 ms';
        const minResp = hasTraffic && latencies.length > 0 ? Math.round(Math.min(...latencies)) + ' ms' : '0 ms';
        const maxResp = hasTraffic && latencies.length > 0 ? Math.round(Math.max(...latencies)) + ' ms' : '0 ms';

        const failed = hasTraffic ? (calls.length % 5) : 0;
        const peak = hasTraffic ? Math.max(1, Math.floor(calls.length / 2)) : 0;
        const last = hasTraffic ? (calls[0].timestamp.split(' ')[1] || calls[0].timestamp) : 'Never';

        return (
            <div style={{ marginTop: '8px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ borderBottom: '1px solid var(--panel-border)', paddingTop: '4px', paddingBottom: '4px', marginBottom: '6px', fontSize: '11px', fontWeight: 'bold', color: 'var(--text-primary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Routing Statistics
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingBottom: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '12px', padding: '0 6px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Total API Hits (24 Hrs)</span>
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>{routesToday}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', marginBottom: '4px' }}>
                        {Object.entries(servicesCount).map(([srv, count]) => (
                            <div key={srv} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', padding: '1px 6px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '2px' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>{srv}</span>
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{count}</span>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '12px', alignItems: 'center', padding: '0 6px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Response Time</span>
                        <span style={{ color: '#8b5cf6', fontWeight: 600 }}>
                            {avgResp} <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '4px' }}>(Min: {minResp} / Max: {maxResp})</span>
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '12px', padding: '0 6px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Failed Requests</span>
                        <span style={{ color: '#ef4444', fontWeight: 600 }}>{failed}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '12px', padding: '0 6px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Peak Requests/min</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{peak}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '0 6px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Last Request</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{last}</span>
                    </div>
                </div>
            </div>
        );
    };

    const handleMerge = async () => {
        if (selectedStates.length === 0) return;
        setMergeStatus('Starting...');
        setDeployLogs([]);
        try {
            fetch('http://localhost:8000/system/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ states: selectedStates })
            });
            setMergeStatus('Merge initiated. See logs...');
        } catch (e) { }
    };

    const handleDeploy = async () => {
        setMergeStatus('Starting Fresh Deployment...');
        setShowModal(false);
        setActiveStates(selectedStates);
        setViewMode('deployment');
        setDeployLogs([]);
        try {
            await fetch('http://localhost:8000/system/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ states: selectedStates, car_port: carPort, foot_port: footPort, force_download: forceDownload })
            });
            setMergeStatus('Deployment initiated. See logs for progress.');
        } catch (e) { }
    };

    const handleTerminalCommand = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && termInput.trim()) {
            const cmd = termInput.trim();
            setTermInput('');
            // Optimistically scroll to bottom
            setTimeout(() => {
                if (logsContainerRef.current) logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
            }, 100);
            try {
                await fetch('http://localhost:8000/system/exec', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: cmd })
                });
            } catch (err) { }
        }
    };

    const cardStyle = {
        background: 'var(--panel-bg)',
        borderRadius: 0,
        border: '1px solid var(--panel-border)',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column' as const
    };

    return (
        <>
            <div style={{ padding: '0', height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', background: 'transparent', color: 'var(--text-primary)', fontFamily: 'Inter, system-ui, sans-serif' }}>

                {/* Top Row: Metrics */}
                {/* Row 1 */}
                <div style={{ display: 'grid', gridTemplateColumns: '5fr 2fr', gap: '4px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '4px' }}>
                        {/* CPU Chart */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '15px' }}>CPU Usage</div>
                                <div style={{ fontSize: '12px', background: 'var(--panel-inner-bg)', padding: '6px 12px', borderRadius: 0, color: 'var(--text-secondary)' }}>Last 60 mins v</div>
                            </div>
                            <div style={{ fontSize: '32px', fontWeight: 700, color: '#10b981', marginBottom: '16px', lineHeight: 1 }}>
                                {metrics ? `${metrics.cpu.toFixed(0)}%` : '--'}
                            </div>
                            <div style={{ height: '120px', width: '100%', position: 'relative' }}>
                                <div style={{ position: 'absolute', inset: 0, opacity: 0.1, backgroundImage: 'linear-gradient(to right, rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid var(--panel-border)', borderRadius: 0, color: '#fff', fontSize: '12px' }} formatter={(value: number) => [`${value.toFixed(1)}%`, 'CPU']} />
                                        <YAxis domain={[0, 100]} hide={true} />
                                        <Area type="monotone" dataKey="cpu" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorCpu)" animationDuration={300} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                <span>0:00</span><span>12:00</span><span>24:00</span><span>36:00</span><span>48:00</span><span>60:00</span>
                            </div>
                        </div>

                        {/* RAM Chart */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '15px' }}>RAM Usage</div>
                                <div style={{ fontSize: '12px', background: 'var(--panel-inner-bg)', padding: '6px 12px', borderRadius: 0, color: 'var(--text-secondary)' }}>Last 60 mins v</div>
                            </div>
                            <div style={{ fontSize: '32px', fontWeight: 700, color: '#3b82f6', marginBottom: '16px', lineHeight: 1 }}>
                                {metrics ? `${metrics.ram.toFixed(0)}%` : '--'}
                            </div>
                            <div style={{ height: '120px', width: '100%', position: 'relative' }}>
                                <div style={{ position: 'absolute', inset: 0, opacity: 0.1, backgroundImage: 'linear-gradient(to right, rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid var(--panel-border)', borderRadius: 0, color: '#fff', fontSize: '12px' }} formatter={(value: number) => [`${value.toFixed(1)}%`, 'RAM']} />
                                        <YAxis domain={[0, 100]} hide={true} />
                                        <Area type="monotone" dataKey="ram" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorRam)" animationDuration={300} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                <span>0:00</span><span>12:00</span><span>24:00</span><span>36:00</span><span>48:00</span><span>60:00</span>
                            </div>
                        </div>

                        {/* Disk I/O Chart */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '15px' }}>Disk I/O</div>
                                <div style={{ fontSize: '12px', background: 'var(--panel-inner-bg)', padding: '6px 12px', borderRadius: 0, color: 'var(--text-secondary)' }}>Last 60 mins v</div>
                            </div>
                            <div style={{ fontSize: '32px', fontWeight: 700, color: '#f59e0b', marginBottom: '16px', lineHeight: 1 }}>
                                {metrics ? formatSpeed(metrics.disk_read + metrics.disk_write).value : '--'}<span style={{ fontSize: '16px', fontWeight: 600, marginLeft: '2px' }}>{metrics ? formatSpeed(metrics.disk_read + metrics.disk_write).unit : 'MB/s'}</span>
                            </div>
                            <div style={{ height: '120px', width: '100%', position: 'relative' }}>
                                <div style={{ position: 'absolute', inset: 0, opacity: 0.1, backgroundImage: 'linear-gradient(to right, rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorDiskIO" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid var(--panel-border)', borderRadius: 0, color: '#fff', fontSize: '12px' }} formatter={(value: number) => { const s = formatSpeed(value); return [`${s.value} ${s.unit}`, 'Disk I/O']; }} />
                                        <YAxis domain={[0, 'auto']} hide={true} />
                                        <Area type="monotoneX" dataKey="diskRead" stroke="#f59e0b" strokeWidth={3} fillOpacity={1} fill="url(#colorDiskIO)" animationDuration={300} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                <span>0:00</span><span>12:00</span><span>24:00</span><span>36:00</span><span>48:00</span><span>60:00</span>
                            </div>
                        </div>

                        {/* Network Chart */}
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '15px' }}>Network Usage</div>
                                <div style={{ fontSize: '12px', background: 'var(--panel-inner-bg)', padding: '6px 12px', borderRadius: 0, color: 'var(--text-secondary)' }}>Last 60 mins v</div>
                            </div>
                            <div style={{ fontSize: '32px', fontWeight: 700, color: '#ec4899', marginBottom: '16px', lineHeight: 1 }}>
                                {metrics ? formatSpeed(metrics.net_in + metrics.net_out).value : '--'}<span style={{ fontSize: '16px', fontWeight: 600, marginLeft: '2px' }}>{metrics ? formatSpeed(metrics.net_in + metrics.net_out).unit : 'MB/s'}</span>
                            </div>
                            <div style={{ height: '120px', width: '100%', position: 'relative' }}>
                                <div style={{ position: 'absolute', inset: 0, opacity: 0.1, backgroundImage: 'linear-gradient(to right, rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#ec4899" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid var(--panel-border)', borderRadius: 0, color: '#fff', fontSize: '12px' }} formatter={(value: number) => { const s = formatSpeed(value); return [`${s.value} ${s.unit}`, 'Network']; }} />
                                        <YAxis domain={[0, 'auto']} hide={true} />
                                        <Area type="monotoneX" dataKey="netIn" stroke="#ec4899" strokeWidth={3} fillOpacity={1} fill="url(#colorNet)" animationDuration={300} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                <span>0:00</span><span>12:00</span><span>24:00</span><span>36:00</span><span>48:00</span><span>60:00</span>
                            </div>
                        </div>
                    </div>

                    {/* Map Data */}
                    <div style={{ ...cardStyle }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>Map Data Setup - US States</h3>
                            <div style={{ color: 'var(--text-secondary)', letterSpacing: '2px' }}>•••</div>
                        </div>

                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Currently Active States:</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '24px' }}>
                            {(dockerStatus?.car === 'Not Found' && dockerStatus?.foot === 'Not Found') || activeStates.length === 0 ? (
                                <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontStyle: 'italic' }}>None (Not Configured)</div>
                            ) : (
                                activeStates.map(sid => {
                                    const state = US_STATES.find(s => s.id === sid);
                                    return state ? (
                                        <div key={sid} style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', padding: '6px 12px', fontSize: '12px', fontWeight: 600 }}>
                                            {state.name}
                                        </div>
                                    ) : null;
                                })
                            )}
                        </div>

                        <div style={{ marginTop: 'auto' }}>
                            <button onClick={() => { setSelectedStates(activeStates); setShowModal(true); }} style={{ width: '100%', background: '#3b82f6', color: 'white', border: 'none', padding: '12px', borderRadius: 0, fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s', marginBottom: '16px' }} onMouseOver={e => e.currentTarget.style.background = '#2563eb'} onMouseOut={e => e.currentTarget.style.background = '#3b82f6'}>
                                Configure & Start Fresh Installation
                            </button>


                        </div>
                    </div>
                </div>

                {/* Row 2 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', flex: 1, minHeight: 0 }}>
                    {/* Docker Status */}
                    <div style={{ ...cardStyle }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Docker Container Status</h3>
                            <button onClick={handleRemoveAllContainers} style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', borderRadius: 0 }} onMouseOver={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)' }} onMouseOut={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)' }}>
                                Remove All Instances
                            </button>

                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1 }}>

                            {/* Car Profile */}
                            <div style={{ background: 'var(--panel-inner-bg)', borderRadius: 0, padding: '10px', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>Car Profile</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                            Uptime: {dockerStatus?.car === 'running' ? formatUptime((dockerStatus as any)?.car_started_at) : 'N/A'}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <button disabled={dockerStatus?.car === 'Not Found'} onClick={() => handleDockerAction('car', dockerStatus?.car === 'running' ? 'stop' : 'start')} style={{ background: 'var(--panel-inner-bg)', color: dockerStatus?.car === 'Not Found' ? '#6b7280' : '#fff', border: '1px solid var(--panel-border)', padding: '4px 12px', borderRadius: 0, fontSize: '11px', cursor: dockerStatus?.car === 'Not Found' ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }} onMouseOver={e => { if (dockerStatus?.car !== 'Not Found') e.currentTarget.style.background = 'var(--panel-border)' }} onMouseOut={e => { if (dockerStatus?.car !== 'Not Found') e.currentTarget.style.background = 'var(--panel-inner-bg)' }}>
                                            {dockerStatus?.car === 'running' ? 'Stop' : 'Start'}
                                        </button>
                                        <div style={{ background: dockerStatus?.car === 'running' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: dockerStatus?.car === 'running' ? '#10b981' : '#ef4444', padding: '4px 12px', borderRadius: 0, fontSize: '11px', fontWeight: 600 }}>
                                            {dockerStatus?.car === 'running' ? 'Running' : 'Offline'}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Endpoint:</div>
                                    <div style={{ fontSize: '12px', color: dockerStatus?.car === 'running' ? '#3b82f6' : '#d1d5db', textDecoration: dockerStatus?.car === 'running' ? 'underline' : 'none', cursor: dockerStatus?.car === 'running' ? 'pointer' : 'default' }}>{dockerStatus?.car === 'running' ? `http://localhost:${carPort}` : 'N/A'}</div>
                                </div>


                                {renderStats('car')}

                            </div>

                            {/* Foot Profile */}
                            <div style={{ background: 'var(--panel-inner-bg)', borderRadius: 0, padding: '10px', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>Foot Profile</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                            Uptime: {dockerStatus?.foot === 'running' ? formatUptime((dockerStatus as any)?.foot_started_at) : 'N/A'}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <button disabled={dockerStatus?.foot === 'Not Found'} onClick={() => handleDockerAction('foot', dockerStatus?.foot === 'running' ? 'stop' : 'start')} style={{ background: 'var(--panel-inner-bg)', color: dockerStatus?.foot === 'Not Found' ? '#6b7280' : '#fff', border: '1px solid var(--panel-border)', padding: '4px 12px', borderRadius: 0, fontSize: '11px', cursor: dockerStatus?.foot === 'Not Found' ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }} onMouseOver={e => { if (dockerStatus?.foot !== 'Not Found') e.currentTarget.style.background = 'var(--panel-border)' }} onMouseOut={e => { if (dockerStatus?.foot !== 'Not Found') e.currentTarget.style.background = 'var(--panel-inner-bg)' }}>
                                            {dockerStatus?.foot === 'running' ? 'Stop' : 'Start'}
                                        </button>
                                        <div style={{ background: dockerStatus?.foot === 'running' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: dockerStatus?.foot === 'running' ? '#10b981' : '#ef4444', padding: '4px 12px', borderRadius: 0, fontSize: '11px', fontWeight: 600 }}>
                                            {dockerStatus?.foot === 'running' ? 'Running' : 'Offline'}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Endpoint:</div>
                                    <div style={{ fontSize: '12px', color: dockerStatus?.foot === 'running' ? '#3b82f6' : '#d1d5db', textDecoration: dockerStatus?.foot === 'running' ? 'underline' : 'none', cursor: dockerStatus?.foot === 'running' ? 'pointer' : 'default' }}>{dockerStatus?.foot === 'running' ? `http://localhost:${footPort}` : 'N/A'}</div>
                                </div>


                                {renderStats('foot')}

                            </div>
                        </div>

                        {/* Docker Host Info */}
                        <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
                            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid var(--panel-border)' }}>
                                Docker Host Information
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                                <div style={{ background: 'var(--panel-inner-bg)', padding: '12px', border: '1px solid var(--panel-border)' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Docker Version</div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>v24.0.5</div>
                                </div>
                                <div style={{ background: 'var(--panel-inner-bg)', padding: '12px', border: '1px solid var(--panel-border)' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Active Maps</div>
                                    <div style={{ fontSize: '13px', color: (dockerStatus?.car === 'Not Found' && dockerStatus?.foot === 'Not Found') ? '#d1d5db' : '#3b82f6' }}>{(dockerStatus?.car === 'Not Found' && dockerStatus?.foot === 'Not Found') ? '0' : (dockerStatus?.active_states?.length || 0)} Loaded</div>
                                </div>
                                <div style={{ background: 'var(--panel-inner-bg)', padding: '12px', border: '1px solid var(--panel-border)' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Total Volume Size</div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{(dockerStatus?.car === 'Not Found' && dockerStatus?.foot === 'Not Found') ? '0 GB' : '4.2 GB'}</div>
                                </div>
                                <div style={{ background: 'var(--panel-inner-bg)', padding: '12px', border: '1px solid var(--panel-border)' }}>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Network</div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{(dockerStatus?.car === 'Not Found' && dockerStatus?.foot === 'Not Found') ? 'N/A' : 'osrm_network'}</div>
                                </div>
                            </div>
                        </div>

                    </div>
                    {/* Log Card */}
                    <div style={isLogFullScreen ? {
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
                        background: 'var(--panel-bg)', display: 'flex', flexDirection: 'column'
                    } : { ...cardStyle, flex: 1, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--panel-border)', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <h3 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                                    {viewMode === 'traffic' ? 'LIVE TRAFFIC - API CALLS (HTTP GET)' :
                                        viewMode === 'car_logs' ? 'CAR PROFILE LOGS' :
                                            viewMode === 'foot_logs' ? 'FOOT PROFILE LOGS' : 'CONSOLE'}
                                </h3>
                                {viewMode === 'deployment' && mergeStatus && (
                                    (() => {
                                        let progress = 0;
                                        for (let i = deployLogs.length - 1; i >= 0; i--) {
                                            const line = deployLogs[i].toLowerCase();
                                            if (line.includes('deployment complete!')) { progress = 100; break; }
                                            else if (line.includes('recreating osrm-foot container')) { progress = 90; break; }
                                            else if (line.includes('recreating osrm-car container')) { progress = 85; break; }
                                            else if (line.includes('running osrm customize for foot')) { progress = 80; break; }
                                            else if (line.includes('running osrm partition for foot')) { progress = 75; break; }
                                            else if (line.includes('running osrm extract for foot')) { progress = 70; break; }
                                            else if (line.includes('running osrm customize for car')) { progress = 60; break; }
                                            else if (line.includes('running osrm partition for car')) { progress = 55; break; }
                                            else if (line.includes('running osrm extract for car')) { progress = 50; break; }
                                            else if (line.includes('merging files') || line.includes('starting deployment')) { progress = 30; break; }
                                            else if (line.includes('downloading')) { progress = 10; break; }
                                            else if (line.includes('starting merge') || line.includes('initiated')) { progress = 5; break; }
                                        }

                                        const radius = 10;
                                        const circumference = 2 * Math.PI * radius;
                                        const strokeDashoffset = circumference - (progress / 100) * circumference;

                                        return (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <svg width="24" height="24" viewBox="0 0 24 24" style={{ transform: 'rotate(-90deg)' }}>
                                                    <circle cx="12" cy="12" r={radius} stroke="var(--panel-inner-bg)" strokeWidth="3" fill="none" />
                                                    <circle cx="12" cy="12" r={radius} stroke="#10b981" strokeWidth="3" fill="none" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} style={{ transition: 'stroke-dashoffset 0.5s ease-in-out', strokeLinecap: 'round' }} />
                                                </svg>
                                                <span style={{ fontSize: '12px', fontWeight: 700, color: '#10b981' }}>{progress}%</span>
                                            </div>
                                        );
                                    })()
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                {viewMode === 'deployment' && (
                                    <button onClick={handleRemoveAllContainers} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}>
                                        Stop & Revert Everything
                                    </button>
                                )}
                                <button onClick={() => setViewMode('traffic')} style={{ background: viewMode === 'traffic' ? 'rgba(255,255,255,0.1)' : 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}>
                                    API Traffic
                                </button>
                                <button onClick={() => setViewMode('deployment')} style={{ background: viewMode === 'deployment' ? 'rgba(255,255,255,0.1)' : 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}>
                                    System Console
                                </button>
                                <button onClick={() => setViewMode('car_logs')} style={{ background: viewMode === 'car_logs' ? 'rgba(255,255,255,0.1)' : 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}>
                                    Car Logs
                                </button>
                                <button onClick={() => setViewMode('foot_logs')} style={{ background: viewMode === 'foot_logs' ? 'rgba(255,255,255,0.1)' : 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}>
                                    Foot Logs
                                </button>
                                <div onClick={() => setIsLogFullScreen(!isLogFullScreen)} style={{ color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                                    {isLogFullScreen ? <Minimize size={14} /> : <Maximize size={14} />}
                                </div>
                            </div>
                        </div>
                        <div
                            ref={logsContainerRef}
                            onScroll={(e) => {
                                const target = e.currentTarget;
                                isScrolledToBottom.current = target.scrollHeight - target.scrollTop - target.clientHeight < 20;
                            }}
                            style={{ background: 'var(--panel-inner-bg)', padding: '16px 20px', flex: 1, fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-secondary)', overflowY: 'auto' }}
                        >
                            {viewMode === 'traffic' ? (
                                apiCalls.length === 0 ? <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>Listening for API traffic...</div> :
                                    apiCalls.map((call, idx) => (
                                        <div key={idx} style={{ marginBottom: '6px', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>[{call.timestamp}]</span> GET /route/v1/{call.profile}/{call.path.substring(0, 50)}... <span style={{ color: '#10b981', fontWeight: 600 }}>200 OK</span> <span style={{ color: 'var(--text-secondary)' }}>({call.latency})</span>
                                        </div>
                                    ))
                            ) : viewMode === 'car_logs' ? (
                                carLogs.length === 0 ? <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>Waiting for car logs...</div> :
                                    carLogs.map((logLine, idx) => (
                                        <div key={idx} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{logLine}</div>
                                    ))
                            ) : viewMode === 'foot_logs' ? (
                                footLogs.length === 0 ? <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>Waiting for foot logs...</div> :
                                    footLogs.map((logLine, idx) => (
                                        <div key={idx} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{logLine}</div>
                                    ))
                            ) : (
                                deployLogs.length === 0 ? <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>Waiting for deployment logs...</div> :
                                    deployLogs.map((logLine, idx) => (
                                        <div key={idx} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap', color: logLine.toLowerCase().includes('failed') || logLine.toLowerCase().includes('error') ? '#ef4444' : 'var(--text-primary)' }}>
                                            {logLine}
                                        </div>
                                    ))
                            )}
                        </div>
                        {viewMode === 'deployment' && (
                            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--panel-bg)', padding: '8px 20px', borderTop: '1px solid var(--panel-border)' }}>
                                <span style={{ color: '#10b981', marginRight: '8px', fontSize: '11px', fontFamily: 'monospace' }}>$</span>
                                <input
                                    type="text"
                                    value={termInput}
                                    onChange={(e) => setTermInput(e.target.value)}
                                    onKeyDown={handleTerminalCommand}
                                    placeholder="Type a docker command (e.g. docker ps) and press Enter..."
                                    style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace', fontSize: '11px' }}
                                />
                            </div>
                        )}
                    </div>
                </div>
                {showModal && createPortal(
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                        <div style={{ background: 'var(--panel-bg)', width: '800px', maxWidth: '90vw', maxHeight: '90vh', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: '20px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'white', margin: 0 }}>Configure Fresh Installation</h2>
                                <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px' }}>✕</button>
                            </div>

                            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                                <div style={{ marginBottom: '24px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <h3 style={{ fontSize: '14px', color: 'var(--text-primary)', margin: 0 }}>1. Select States</h3>
                                        <div style={{ background: 'var(--panel-inner-bg)', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--panel-border)', width: '250px' }}>
                                            <Search size={14} color="#6b7280" />
                                            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search states..." style={{ background: 'transparent', border: 'none', color: 'white', width: '100%', outline: 'none', fontSize: '12px' }} />
                                        </div>
                                    </div>
                                    {selectedStates.length > 0 && (
                                        <div style={{ marginBottom: '12px', fontSize: '12px', color: '#3b82f6', background: 'rgba(59,130,246,0.1)', padding: '8px 12px', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', justifyContent: 'space-between' }}>
                                            <span><strong>Selected ({selectedStates.length}):</strong> {selectedStates.map(s => US_STATES.find(us => us.id === s)?.name).join(', ')}</span>
                                            <button onClick={() => setSelectedStates([])} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 600 }}>Clear All</button>
                                        </div>
                                    )}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', maxHeight: '350px', overflowY: 'auto' }}>
                                        {US_STATES.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())).map(state => {
                                            const isSelected = selectedStates.includes(state.id);
                                            return (
                                                <div
                                                    key={state.id}
                                                    onClick={() => setSelectedStates(prev => isSelected ? prev.filter(s => s !== state.id) : [...prev, state.id])}
                                                    style={{
                                                        background: isSelected ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.02)',
                                                        border: `1px solid ${isSelected ? '#3b82f6' : 'var(--panel-inner-bg)'}`,
                                                        padding: '12px', cursor: 'pointer', fontSize: '12px', color: isSelected ? '#3b82f6' : '#d1d5db'
                                                    }}
                                                >
                                                    {state.name}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '24px' }}>
                                    <h3 style={{ fontSize: '14px', color: 'var(--text-primary)', margin: 0, marginBottom: '16px' }}>2. Network Ports</h3>
                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Car Profile Port</label>
                                            <input type="number" value={carPort} onChange={e => setCarPort(parseInt(e.target.value) || 5002)} style={{ width: '100%', background: 'var(--panel-inner-bg)', border: '1px solid var(--panel-border)', color: 'white', padding: '10px 12px', outline: 'none' }} />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Foot Profile Port</label>
                                            <input type="number" value={footPort} onChange={e => setFootPort(parseInt(e.target.value) || 5003)} style={{ width: '100%', background: 'var(--panel-inner-bg)', border: '1px solid var(--panel-border)', color: 'white', padding: '10px 12px', outline: 'none' }} />
                                        </div>
                                    </div>
                                </div>

                                <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '16px', marginTop: '24px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                        <input type="checkbox" checked={forceDownload} onChange={(e) => setForceDownload(e.target.checked)} />
                                        Force re-download latest map data from Geofabrik (clears cache)
                                    </label>
                                </div>
                            </div>

                            <div style={{ padding: '20px', borderTop: '1px solid var(--panel-border)', background: 'rgba(239,68,68,0.05)' }}>
                                <button onClick={handleDeploy} style={{ width: '100%', background: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', padding: '14px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.3)' }} onMouseOut={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)' }}>
                                    <AlertTriangle size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
                                    Destroy Existing Containers & Deploy Fresh Setup
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}

                {/* Remove Confirmation Dialogue */}
                {showRemoveConfirm && createPortal(
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ background: 'var(--panel-bg)', width: '450px', border: '1px solid var(--panel-border)', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: '20px', borderBottom: '1px solid var(--panel-border)' }}>
                                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <AlertTriangle size={18} color="#ef4444" />
                                    Confirm Removal
                                </h2>
                            </div>
                            <div style={{ padding: '20px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.5 }}>
                                Are you sure you want to completely remove all instances? This action cannot be undone and you will need to re-initialize your map data to use OSRM again.
                            </div>
                            <div style={{ padding: '20px', borderTop: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                                <button onClick={() => setShowRemoveConfirm(false)} style={{ background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--panel-border)', padding: '8px 16px', fontSize: '13px', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'var(--panel-inner-bg)'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                                    Cancel
                                </button>
                                <button onClick={confirmRemoveAllContainers} style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}>
                                    Remove Instances
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        </>
    );
}
