import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, AlertTriangle, Maximize, Minimize, Settings } from 'lucide-react';
import { AreaChart, Area, Tooltip, ResponsiveContainer, YAxis } from 'recharts';

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



export default function EngineSetup({ isActive = true }: { isActive?: boolean }) {
    const role = localStorage.getItem('role') || 'admin';
    const [metrics, setMetrics] = useState<{ cpu: number, ram: number, disk_read: number, disk_write: number, net_in: number, net_out: number } | null>(null);
    const [history, setHistory] = useState<any[]>(generateMockHistory());
    const [dockerStatus, setDockerStatus] = useState<{ car: string, foot: string, nominatim?: string, pelias?: string, active_states?: any } | null>(null);
    const [selectedStates, setSelectedStates] = useState<Record<string, string[]>>({ car: [], foot: [], nominatim: [], pelias: [] });
    const [modalTab, setModalTab] = useState<'car' | 'foot' | 'nominatim' | 'pelias'>('car');
    const [mergeStatus, setMergeStatus] = useState<string | null>(null);
    const [apiCalls, setApiCalls] = useState<any[]>([]);
    const [carPort, setCarPort] = useState<number>(5001);
    const [footPort, setFootPort] = useState<number>(5005);
    const [nominatimPort, setNominatimPort] = useState<number>(8080);
    const [peliasPort, setPeliasPort] = useState<number>(4000);

    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [carLogs, setCarLogs] = useState<string[]>([]);
    const [footLogs, setFootLogs] = useState<string[]>([]);
    const [nominatimLogs, setNominatimLogs] = useState<string[]>([]);
    const [peliasLogs, setPeliasLogs] = useState<string[]>([]);
    const [deployLogs, setDeployLogs] = useState<string[]>([]);
    const [viewMode, setViewMode] = useState<'traffic' | 'deployment' | 'car_logs' | 'foot_logs' | 'nominatim_logs' | 'pelias_logs'>('traffic');
    const [activeStates, setActiveStates] = useState<Record<string, string[]>>({ car: [], foot: [], nominatim: [], pelias: [] });
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
    const [termInput, setTermInput] = useState('');
    const [statesPopup, setStatesPopup] = useState<{ profile: string, states: string[] } | null>(null);
    const [isLogFullScreen, setIsLogFullScreen] = useState(false);
    const logsContainerRef = useRef<HTMLDivElement>(null);
    const isScrolledToBottom = useRef(true);

    const isDeploying = deployLogs.length > 0 && 
                       !deployLogs[deployLogs.length - 1].includes('Deployment complete!') &&
                       !deployLogs[deployLogs.length - 1].includes('Deployment failed') &&
                       !deployLogs[deployLogs.length - 1].includes('Listening for deployment events...');

    useEffect(() => {
        if (logsContainerRef.current && isScrolledToBottom.current) {
            logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
    }, [apiCalls, deployLogs, viewMode]);

    const toggleState = (sid: string) => {
        setSelectedStates(prev => {
            const currentTabStates = prev[modalTab] || [];
            if (currentTabStates.includes(sid)) {
                return { ...prev, [modalTab]: currentTabStates.filter(s => s !== sid) };
            } else {
                return { ...prev, [modalTab]: [...currentTabStates, sid] };
            }
        });
    };

    useEffect(() => {
        const fetchMetrics = async () => {
            try {
                const res = await fetch(`/api/system/metrics`);
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
                const res = await fetch(`/api/system/docker`);
                if (res.ok) {
                    const data = await res.json();
                    setDockerStatus(data);
                    if (data.car_port) setCarPort(data.car_port);
                    if (data.foot_port) setFootPort(data.foot_port);
                    if (data.nominatim_port) setNominatimPort(data.nominatim_port);
                    if (data.pelias_port) setPeliasPort(data.pelias_port);
                    
                    if (data.active_states) {
                        if (Array.isArray(data.active_states)) {
                            setActiveStates({ car: data.active_states, foot: data.active_states, nominatim: data.active_states, pelias: data.active_states });
                        } else {
                            setActiveStates(data.active_states);
                        }
                    }
                }
            } catch (e) { }
        };

        const fetchApiCalls = async () => {
            try {
                const res = await fetch(`/api/system/api-calls`);
                if (res.ok) {
                    const data = await res.json();
                    setApiCalls(data.calls || []);
                }
            } catch (e) { }
        };

        const fetchDeployLogs = async () => {
            try {
                const res = await fetch(`/api/system/logs`);
                if (res.ok) {
                    const data = await res.json();
                    setDeployLogs(data.logs || []);
                }
            } catch (e) { }
            try {
                const resCar = await fetch(`/api/system/docker/car/logs`);
                if (resCar.ok) {
                    const data = await resCar.json();
                    setCarLogs(data.logs || []);
                }
            } catch (e) { }
            try {
                const resFoot = await fetch(`/api/system/docker/foot/logs`);
                if (resFoot.ok) {
                    const data = await resFoot.json();
                    setFootLogs(data.logs || []);
                }
            } catch (e) { }
            try {
                const resNom = await fetch(`/api/system/docker/nominatim/logs`);
                if (resNom.ok) {
                    const data = await resNom.json();
                    setNominatimLogs(data.logs || []);
                }
            } catch (e) { }
            try {
                const resPel = await fetch(`/api/system/docker/pelias/logs`);
                if (resPel.ok) {
                    const data = await resPel.json();
                    setPeliasLogs(data.logs || []);
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
            await fetch(`/api/system/docker/remove-all`, { method: 'POST' });
        } catch (e) { }
    };

    const handleDockerAction = async (profile: string, action: 'start' | 'stop' | 'clear_logs') => {
        if (action === 'clear_logs') {
            if (!window.confirm(`Are you sure you want to permanently clear the docker logs for ${profile.toUpperCase()}? This cannot be undone.`)) {
                return;
            }
        }
        try {
            await fetch(`/api/system/docker/${profile}/${action}`, { method: 'POST' });
            if (action === 'clear_logs') {
                if (profile === 'car') setCarLogs([]);
                else if (profile === 'foot') setFootLogs([]);
                else if (profile === 'nominatim') setNominatimLogs([]);
                else if (profile === 'pelias') setPeliasLogs([]);
            }
        } catch (e) { }
    };

    const formatBytes = (bytes: number | undefined) => {
        if (bytes === undefined || bytes === null || isNaN(bytes)) return 'Unknown';
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

        const defaultServices = (profile === 'nominatim' ? { search: 0, reverse: 0, lookup: 0, status: 0 } :
                                profile === 'pelias' ? { search: 0, reverse: 0, autocomplete: 0, place: 0 } :
                                { route: 0, nearest: 0, table: 0, match: 0, trip: 0, tile: 0 }) as unknown as Record<string, number>;

        const servicesCount = calls.reduce((acc, c) => {
            const s = c.service || (profile === 'nominatim' ? 'search' : profile === 'pelias' ? 'search' : 'route');
            acc[s] = (acc[s] || 0) + 1;
            return acc;
        }, defaultServices as Record<string, number>);

        const latencies = calls.map(c => parseFloat(c.latency) || 0).filter(l => l > 0);
        const avgResp = hasTraffic && latencies.length > 0 ? Math.round(latencies.reduce((sum, l) => sum + l, 0) / latencies.length) + ' ms' : '0 ms';
        const minResp = hasTraffic && latencies.length > 0 ? Math.round(Math.min(...latencies)) + ' ms' : '0 ms';
        const maxResp = hasTraffic && latencies.length > 0 ? Math.round(Math.max(...latencies)) + ' ms' : '0 ms';

        const failed = 0; // The backend /api-calls endpoint currently only parses successful [info] logs
        const peak = hasTraffic ? Math.max(1, Math.ceil(calls.length / (24 * 60))) : 0; // Actually estimate per minute based on 24h
        const last = hasTraffic ? (calls[0].timestamp.split(' ')[1] || calls[0].timestamp) : 'Never';

        return (
            <div style={{ marginTop: '8px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingTop: '4px', paddingBottom: '4px', marginBottom: '6px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-primary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                        {profile === 'nominatim' || profile === 'pelias' ? 'Geocoding Statistics' : 'Routing Statistics'}
                    </div>
                    <button disabled={role === "guest" || (dockerStatus as any)?.[profile] === 'Not Found'} onClick={() => handleDockerAction(profile, 'clear_logs')} style={{ background: 'transparent', color: (dockerStatus as any)?.[profile] === 'Not Found' ? '#6b7280' : 'var(--text-secondary)', border: 'none', padding: '0', fontSize: '10px', cursor: role === "guest" || (dockerStatus as any)?.[profile] === 'Not Found' ? 'not-allowed' : 'pointer', opacity: role === "guest" ? 0.5 : 1, textDecoration: 'underline' }} title="Clear Logs">
                        Clear Logs
                    </button>
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', paddingBottom: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '12px', padding: '0 6px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Total API Hits (24 Hrs)</span>
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>{routesToday}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', marginBottom: '4px' }}>
                        {Object.entries(servicesCount).map(([srv, count]: [string, any]) => (
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

    const renderContainerStatus = (status: string | undefined) => {
        let text = "Offline";
        let color = "#f97316"; // Orange
        let bg = "rgba(249, 115, 22, 0.1)";

        if (status === 'running') {
            text = "Online";
            color = "#10b981"; // Green
            bg = "rgba(16, 185, 129, 0.1)";
        } else if (status === 'Not Found' || !status) {
            text = "Not Installed";
            color = "#ef4444"; // Red
            bg = "rgba(239, 68, 68, 0.1)";
        }

        return (
            <div style={{ 
                background: bg, 
                color: color, 
                padding: '4px 12px', 
                borderRadius: 0, 
                fontSize: '11px', 
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
            }}>
                <div className="blink" style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    backgroundColor: color,
                    '--current-color': color
                } as any} />
                {text}
            </div>
        );
    };

    const renderInstalledStates = (profile: 'car' | 'foot' | 'nominatim' | 'pelias') => {
        const states = activeStates[profile] || [];
        const logSize = formatBytes((dockerStatus as any)?.[`${profile}_log_size`]);
        
        return (
            <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div 
                    style={{ fontSize: '11px', color: states.length > 0 ? '#3b82f6' : 'var(--text-secondary)', cursor: states.length > 0 ? 'pointer' : 'default', textDecoration: states.length > 0 ? 'underline' : 'none' }}
                    onClick={() => states.length > 0 && setStatesPopup({ profile, states })}
                    title={states.length > 0 ? "Click to view installed states" : ""}
                >
                    {states.length} Installed State{states.length !== 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Log Size: <span style={{ color: 'var(--text-primary)' }}>{logSize}</span>
                </div>
            </div>
        );
    };

    const renderConfigButton = (profile: 'car' | 'foot' | 'nominatim' | 'pelias') => {
        return (
            <button disabled={role === "guest" || isDeploying} onClick={() => { setModalTab(profile); setSelectedStates(activeStates); setShowModal(true); }} style={{ background: 'var(--panel-inner-bg)', color: 'var(--text-primary)', border: '1px solid var(--panel-border)', padding: '4px 12px', borderRadius: 0, fontSize: '11px', cursor: role === "guest" || isDeploying ? "not-allowed" : "pointer", opacity: role === "guest" || isDeploying ? 0.5 : 1, transition: 'background 0.2s', display: 'flex', alignItems: 'center', gap: '4px' }} onMouseOver={e => { if(!isDeploying && role !== "guest") e.currentTarget.style.background = 'var(--panel-border)' }} onMouseOut={e => { if(!isDeploying && role !== "guest") e.currentTarget.style.background = 'var(--panel-inner-bg)' }} title="Configure Profile">
                <Settings size={12} /> Configure
            </button>
        );
    };

    const handleDeploy = async () => {
        setMergeStatus('Starting Fresh Deployment...');
        setShowModal(false);
        setActiveStates(selectedStates);
        setViewMode('deployment');
        setDeployLogs([]);
        const engines = {
            car: modalTab === 'car',
            foot: modalTab === 'foot',
            nominatim: modalTab === 'nominatim',
            pelias: modalTab === 'pelias'
        };
        try {
            await fetch(`/api/system/merge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ states: selectedStates, car_port: carPort, foot_port: footPort, nominatim_port: nominatimPort, pelias_port: peliasPort, force_download: false, engines })
            });
            setMergeStatus('Deployment initiated. See logs for progress.');
        } catch (e) { }
    };

    const handleUpdate = async () => {
        setMergeStatus('Starting Zero-Downtime Update...');
        setShowModal(false);
        setActiveStates(selectedStates);
        setViewMode('deployment');
        setDeployLogs([]);
        const engines = {
            car: modalTab === 'car',
            foot: modalTab === 'foot',
            nominatim: modalTab === 'nominatim',
            pelias: modalTab === 'pelias'
        };
        try {
            await fetch(`/api/system/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ states: selectedStates, car_port: carPort, foot_port: footPort, nominatim_port: nominatimPort, pelias_port: peliasPort, force_download: false, engines })
            });
            setMergeStatus('Zero-Downtime Update initiated. See logs for progress.');
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
                await fetch(`/api/system/exec`, {
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
            <div style={{ padding: '0', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '4px', background: 'transparent', color: 'var(--text-primary)', fontFamily: 'Inter, system-ui, sans-serif' }}>

                {/* Top Row: Metrics */}
                {/* Row 1 */}
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
                                        {isActive && <Tooltip isAnimationActive={false} contentStyle={{ background: '#1f2937', border: '1px solid var(--panel-border)', borderRadius: 0, color: '#fff', fontSize: '12px' }} formatter={(value: any) => [`${(value || 0).toFixed(1)}%`, 'CPU']} />}
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
                                        {isActive && <Tooltip isAnimationActive={false} contentStyle={{ background: '#1f2937', border: '1px solid var(--panel-border)', borderRadius: 0, color: '#fff', fontSize: '12px' }} formatter={(value: any) => [`${(value || 0).toFixed(1)}%`, 'RAM']} />}
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
                                        {isActive && <Tooltip isAnimationActive={false} contentStyle={{ background: '#1f2937', border: '1px solid var(--panel-border)', borderRadius: 0, color: '#fff', fontSize: '12px' }} formatter={(value: any) => { const s = formatSpeed(value); return [`${s.value} ${s.unit}`, 'Disk I/O']; }} />}
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
                                        {isActive && <Tooltip isAnimationActive={false} contentStyle={{ background: '#1f2937', border: '1px solid var(--panel-border)', borderRadius: 0, color: '#fff', fontSize: '12px' }} formatter={(value: any) => { const s = formatSpeed(value); return [`${s.value} ${s.unit}`, 'Network']; }} />}
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

                {/* Row 2 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minHeight: 0 }}>
                    {/* Docker Status */}
                    <div style={{ ...cardStyle }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Docker Container Status</h3>
                            <button disabled={role === "guest"} onClick={handleRemoveAllContainers} style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: role === "guest" ? "not-allowed" : "pointer", opacity: role === "guest" ? 0.5 : 1, transition: 'all 0.2s', borderRadius: 0 }} onMouseOver={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)' }} onMouseOut={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)' }}>
                                Remove All Instances
                            </button>

                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', flex: 1 }}>

                            {/* Car Profile */}
                            <div style={{ background: 'var(--panel-inner-bg)', borderRadius: 0, padding: '10px', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>Car Profile</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        {renderConfigButton('car')}
                                        <button disabled={role === "guest" || dockerStatus?.car === 'Not Found'} onClick={() => handleDockerAction('car', dockerStatus?.car === 'running' ? 'stop' : 'start')} style={{ background: 'var(--panel-inner-bg)', color: dockerStatus?.car === 'Not Found' ? '#6b7280' : 'var(--text-primary)', border: '1px solid var(--panel-border)', padding: '4px 12px', borderRadius: 0, fontSize: '11px', cursor: role === "guest" || dockerStatus?.car === 'Not Found' ? 'not-allowed' : 'pointer', opacity: role === "guest" ? 0.5 : 1, transition: 'background 0.2s' }} onMouseOver={e => { if (dockerStatus?.car !== 'Not Found') e.currentTarget.style.background = 'var(--panel-border)' }} onMouseOut={e => { if (dockerStatus?.car !== 'Not Found') e.currentTarget.style.background = 'var(--panel-inner-bg)' }}>
                                            {dockerStatus?.car === 'running' ? 'Stop' : 'Start'}
                                        </button>
                                        {renderContainerStatus(dockerStatus?.car)}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Endpoint:</div>
                                        <div style={{ fontSize: '12px', color: dockerStatus?.car === 'running' ? '#3b82f6' : '#d1d5db', textDecoration: dockerStatus?.car === 'running' ? 'underline' : 'none', cursor: dockerStatus?.car === 'running' ? 'pointer' : 'default' }}>{dockerStatus?.car === 'running' ? `http://${window.location.hostname}:${(dockerStatus as any)?.car_port || carPort}` : 'N/A'}</div>
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                        Uptime: <span style={{ color: 'var(--text-primary)' }}>{dockerStatus?.car === 'running' ? formatUptime((dockerStatus as any)?.car_started_at) : 'N/A'}</span>
                                    </div>
                                </div>
                                {renderInstalledStates('car')}

                                {renderStats('car')}

                            </div>

                            {/* Foot Profile */}
                            <div style={{ background: 'var(--panel-inner-bg)', borderRadius: 0, padding: '10px', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>Foot Profile</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        {renderConfigButton('foot')}
                                        <button disabled={role === "guest" || dockerStatus?.foot === 'Not Found'} onClick={() => handleDockerAction('foot', dockerStatus?.foot === 'running' ? 'stop' : 'start')} style={{ background: 'var(--panel-inner-bg)', color: dockerStatus?.foot === 'Not Found' ? '#6b7280' : 'var(--text-primary)', border: '1px solid var(--panel-border)', padding: '4px 12px', borderRadius: 0, fontSize: '11px', cursor: role === "guest" || dockerStatus?.foot === 'Not Found' ? 'not-allowed' : 'pointer', opacity: role === "guest" ? 0.5 : 1, transition: 'background 0.2s' }} onMouseOver={e => { if (dockerStatus?.foot !== 'Not Found') e.currentTarget.style.background = 'var(--panel-border)' }} onMouseOut={e => { if (dockerStatus?.foot !== 'Not Found') e.currentTarget.style.background = 'var(--panel-inner-bg)' }}>
                                            {dockerStatus?.foot === 'running' ? 'Stop' : 'Start'}
                                        </button>
                                        {renderContainerStatus(dockerStatus?.foot)}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Endpoint:</div>
                                        <div style={{ fontSize: '12px', color: dockerStatus?.foot === 'running' ? '#3b82f6' : '#d1d5db', textDecoration: dockerStatus?.foot === 'running' ? 'underline' : 'none', cursor: dockerStatus?.foot === 'running' ? 'pointer' : 'default' }}>{dockerStatus?.foot === 'running' ? `http://${window.location.hostname}:${(dockerStatus as any)?.foot_port || footPort}` : 'N/A'}</div>
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                        Uptime: <span style={{ color: 'var(--text-primary)' }}>{dockerStatus?.foot === 'running' ? formatUptime((dockerStatus as any)?.foot_started_at) : 'N/A'}</span>
                                    </div>
                                </div>
                                {renderInstalledStates('foot')}

                                {renderStats('foot')}

                            </div>

                            {/* Nominatim Profile */}
                            <div style={{ background: 'var(--panel-inner-bg)', borderRadius: 0, padding: '10px', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>Nominatim</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        {renderConfigButton('nominatim')}
                                        <button disabled={role === "guest" || dockerStatus?.nominatim === 'Not Found'} onClick={() => handleDockerAction('nominatim', dockerStatus?.nominatim === 'running' ? 'stop' : 'start')} style={{ background: 'var(--panel-inner-bg)', color: dockerStatus?.nominatim === 'Not Found' ? '#6b7280' : 'var(--text-primary)', border: '1px solid var(--panel-border)', padding: '4px 12px', borderRadius: 0, fontSize: '11px', cursor: role === "guest" || dockerStatus?.nominatim === 'Not Found' ? 'not-allowed' : 'pointer', opacity: role === "guest" ? 0.5 : 1, transition: 'background 0.2s' }} onMouseOver={e => { if (dockerStatus?.nominatim !== 'Not Found') e.currentTarget.style.background = 'var(--panel-border)' }} onMouseOut={e => { if (dockerStatus?.nominatim !== 'Not Found') e.currentTarget.style.background = 'var(--panel-inner-bg)' }}>
                                            {dockerStatus?.nominatim === 'running' ? 'Stop' : 'Start'}
                                        </button>
                                        {renderContainerStatus(dockerStatus?.nominatim)}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Endpoint:</div>
                                        <a href={dockerStatus?.nominatim === 'running' ? `http://${window.location.hostname}:${(dockerStatus as any)?.nominatim_port || nominatimPort}/status` : '#'} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: dockerStatus?.nominatim === 'running' ? '#3b82f6' : '#d1d5db', textDecoration: dockerStatus?.nominatim === 'running' ? 'underline' : 'none', cursor: dockerStatus?.nominatim === 'running' ? 'pointer' : 'default' }}>{dockerStatus?.nominatim === 'running' ? `http://${window.location.hostname}:${(dockerStatus as any)?.nominatim_port || nominatimPort}/status` : 'N/A'}</a>
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                        Uptime: <span style={{ color: 'var(--text-primary)' }}>{dockerStatus?.nominatim === 'running' ? formatUptime((dockerStatus as any)?.nominatim_started_at) : 'N/A'}</span>
                                    </div>
                                </div>
                                {renderInstalledStates('nominatim')}

                                {renderStats('nominatim')}

                            </div>

                            {/* Pelias Profile */}
                            <div style={{ background: 'var(--panel-inner-bg)', borderRadius: 0, padding: '10px', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>Pelias (OSM)</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        {renderConfigButton('pelias')}
                                        <button disabled={role === "guest" || dockerStatus?.pelias === 'Not Found'} onClick={() => handleDockerAction('pelias', dockerStatus?.pelias === 'running' ? 'stop' : 'start')} style={{ background: 'var(--panel-inner-bg)', color: dockerStatus?.pelias === 'Not Found' ? '#6b7280' : 'var(--text-primary)', border: '1px solid var(--panel-border)', padding: '4px 12px', borderRadius: 0, fontSize: '11px', cursor: role === "guest" || dockerStatus?.pelias === 'Not Found' ? 'not-allowed' : 'pointer', opacity: role === "guest" ? 0.5 : 1, transition: 'background 0.2s' }} onMouseOver={e => { if (dockerStatus?.pelias !== 'Not Found') e.currentTarget.style.background = 'var(--panel-border)' }} onMouseOut={e => { if (dockerStatus?.pelias !== 'Not Found') e.currentTarget.style.background = 'var(--panel-inner-bg)' }}>
                                            {dockerStatus?.pelias === 'running' ? 'Stop' : 'Start'}
                                        </button>
                                        {renderContainerStatus(dockerStatus?.pelias)}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Endpoint:</div>
                                        <div style={{ fontSize: '12px', color: dockerStatus?.pelias === 'running' ? '#3b82f6' : '#d1d5db', textDecoration: dockerStatus?.pelias === 'running' ? 'underline' : 'none', cursor: dockerStatus?.pelias === 'running' ? 'pointer' : 'default' }}>{dockerStatus?.pelias === 'running' ? `http://${window.location.hostname}:${(dockerStatus as any)?.pelias_port || peliasPort}` : 'N/A'}</div>
                                    </div>
                                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                        Uptime: <span style={{ color: 'var(--text-primary)' }}>{dockerStatus?.pelias === 'running' ? formatUptime((dockerStatus as any)?.pelias_started_at) : 'N/A'}</span>
                                    </div>
                                </div>
                                {renderInstalledStates('pelias')}

                                {renderStats('pelias')}

                            </div>
                        </div>



                    </div>
                    {/* Log Card */}
                    <div style={isLogFullScreen ? {
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
                        background: 'var(--panel-bg)', display: 'flex', flexDirection: 'column'
                    } : { ...cardStyle, flex: 1, minHeight: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--panel-border)', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <h3 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                                    {viewMode === 'traffic' ? 'LIVE TRAFFIC - API CALLS (HTTP GET)' :
                                        viewMode === 'car_logs' ? 'CAR PROFILE LOGS' :
                                            viewMode === 'foot_logs' ? 'FOOT PROFILE LOGS' :
                                                viewMode === 'nominatim_logs' ? 'NOMINATIM LOGS' :
                                                    viewMode === 'pelias_logs' ? 'PELIAS LOGS' : 'CONSOLE'}
                                </h3>
                                {viewMode === 'deployment' && mergeStatus && (
                                    (() => {
                                        let progress = 0;
                                        for (let i = deployLogs.length - 1; i >= 0; i--) {
                                            const line = deployLogs[i].toLowerCase();
                                            if (line.includes('deployment complete!')) { progress = 100; break; }
                                            else if (line.includes('rebuilding pelias')) { progress = 95; break; }
                                            else if (line.includes('recreating nominatim') || line.includes('restarting nominatim')) { progress = 90; break; }
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
                                    <button disabled={role === "guest"} onClick={handleRemoveAllContainers} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}>
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
                                <button onClick={() => setViewMode('nominatim_logs')} style={{ background: viewMode === 'nominatim_logs' ? 'rgba(255,255,255,0.1)' : 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}>
                                    Nominatim
                                </button>
                                <button onClick={() => setViewMode('pelias_logs')} style={{ background: viewMode === 'pelias_logs' ? 'rgba(255,255,255,0.1)' : 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '2px 8px', fontSize: '10px', cursor: 'pointer' }}>
                                    Pelias
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
                            ) : viewMode === 'nominatim_logs' ? (
                                nominatimLogs.length === 0 ? <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>Waiting for nominatim logs...</div> :
                                    nominatimLogs.map((logLine, idx) => (
                                        <div key={idx} style={{ marginBottom: '4px', whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{logLine}</div>
                                    ))
                            ) : viewMode === 'pelias_logs' ? (
                                peliasLogs.length === 0 ? <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>Waiting for pelias logs...</div> :
                                    peliasLogs.map((logLine, idx) => (
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
                            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--panel-bg)', padding: '8px 20px', borderTop: '1px solid var(--panel-border)', opacity: role === 'guest' ? 0.5 : 1 }}>
                                <span style={{ color: '#10b981', marginRight: '8px', fontSize: '11px', fontFamily: 'monospace' }}>$</span>
                                <input
                                    type="text"
                                    value={termInput}
                                    onChange={(e) => setTermInput(e.target.value)}
                                    onKeyDown={handleTerminalCommand}
                                    placeholder={role === 'guest' ? "Terminal disabled for guest users" : "Type a docker command (e.g. docker ps) and press Enter..."}
                                    disabled={role === 'guest'}
                                    style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace', fontSize: '11px', cursor: role === 'guest' ? 'not-allowed' : 'text' }}
                                />
                            </div>
                        )}
                    </div>
                </div>
                {showModal && createPortal(
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
                        <div style={{ background: 'var(--panel-bg)', width: '800px', maxWidth: '90vw', maxHeight: '90vh', border: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: '20px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'white', margin: 0, textTransform: 'capitalize' }}>Configure {modalTab}</h2>
                                <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px' }}>X</button>
                            </div>

                            <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <h3 style={{ fontSize: '14px', color: 'var(--text-primary)', margin: 0 }}>1. Select States</h3>
                                        <div style={{ background: 'var(--panel-inner-bg)', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--panel-border)', width: '250px' }}>
                                            <Search size={14} color="#6b7280" />
                                            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search states..." style={{ background: 'transparent', border: 'none', color: 'white', width: '100%', outline: 'none', fontSize: '12px' }} />
                                        </div>
                                    </div>
                                    {/* Tabs removed to isolate configuration to a single engine at a time */}

                                    {(selectedStates[modalTab] || []).length > 0 && (
                                        <div style={{ marginBottom: '12px', fontSize: '12px', color: '#3b82f6', background: 'rgba(59,130,246,0.1)', padding: '8px 12px', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', justifyContent: 'space-between' }}>
                                            <span><strong>Selected ({(selectedStates[modalTab] || []).length}):</strong> {(selectedStates[modalTab] || []).map((s: string) => US_STATES.find(us => us.id === s)?.name).join(', ')}</span>
                                            <button disabled={role === "guest"} onClick={() => setSelectedStates(prev => ({...prev, [modalTab]: []}))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 600 }}>Clear {modalTab.toUpperCase()}</button>
                                        </div>
                                    )}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: '4px', alignContent: 'start' }}>
                                        {US_STATES.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())).map(state => {
                                            const currentTabStates = selectedStates[modalTab] || [];
                                            const isSelected = currentTabStates.includes(state.id);
                                            return (
                                                <div
                                                    key={state.id}
                                                    onClick={() => toggleState(state.id)}
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

                                <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '24px', marginTop: '24px', flexShrink: 0 }}>
                                    <h3 style={{ fontSize: '14px', color: 'var(--text-primary)', margin: 0, marginBottom: '16px' }}>2. Network Ports</h3>
                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        {modalTab === 'car' && (
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Car Profile Port</label>
                                                <input type="number" value={carPort} onChange={e => setCarPort(parseInt(e.target.value) || 5001)} style={{ width: '100%', background: 'var(--panel-inner-bg)', border: '1px solid var(--panel-border)', color: 'white', padding: '10px 12px', outline: 'none' }} />
                                            </div>
                                        )}
                                        {modalTab === 'foot' && (
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Foot Profile Port</label>
                                                <input type="number" value={footPort} onChange={e => setFootPort(parseInt(e.target.value) || 5005)} style={{ width: '100%', background: 'var(--panel-inner-bg)', border: '1px solid var(--panel-border)', color: 'white', padding: '10px 12px', outline: 'none' }} />
                                            </div>
                                        )}
                                        {modalTab === 'nominatim' && (
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Nominatim Port</label>
                                                <input type="number" value={nominatimPort} onChange={e => setNominatimPort(parseInt(e.target.value) || 8080)} style={{ width: '100%', background: 'var(--panel-inner-bg)', border: '1px solid var(--panel-border)', color: 'white', padding: '10px 12px', outline: 'none' }} />
                                            </div>
                                        )}
                                        {modalTab === 'pelias' && (
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Pelias Port</label>
                                                <input type="number" value={peliasPort} onChange={e => setPeliasPort(parseInt(e.target.value) || 4000)} style={{ width: '100%', background: 'var(--panel-inner-bg)', border: '1px solid var(--panel-border)', color: 'white', padding: '10px 12px', outline: 'none' }} />
                                            </div>
                                        )}
                                    </div>
                                </div>

                            </div>

                            <div style={{ padding: '20px', borderTop: '1px solid var(--panel-border)', background: 'rgba(239,68,68,0.05)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {(() => {
                                    const hasAnySelection = (selectedStates[modalTab]?.length || 0) > 0;
                                    const isBtnDisabled = role === "guest" || !hasAnySelection;
                                    return (
                                        <>
                                            <button disabled={isBtnDisabled} onClick={handleUpdate} style={{ width: '100%', background: 'rgba(16,185,129,0.2)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', padding: '14px', fontSize: '14px', fontWeight: 600, cursor: isBtnDisabled ? "not-allowed" : "pointer", opacity: isBtnDisabled ? 0.5 : 1, transition: 'all 0.2s' }} onMouseOver={e => { if (!isBtnDisabled) e.currentTarget.style.background = 'rgba(16,185,129,0.3)' }} onMouseOut={e => { if (!isBtnDisabled) e.currentTarget.style.background = 'rgba(16,185,129,0.2)' }}>
                                                <AlertTriangle size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
                                                Update States (Zero Downtime)
                                            </button>
                                            <button disabled={isBtnDisabled} onClick={handleDeploy} style={{ width: '100%', background: 'rgba(239,68,68,0.2)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', padding: '14px', fontSize: '14px', fontWeight: 600, cursor: isBtnDisabled ? "not-allowed" : "pointer", opacity: isBtnDisabled ? 0.5 : 1, transition: 'all 0.2s' }} onMouseOver={e => { if (!isBtnDisabled) e.currentTarget.style.background = 'rgba(239,68,68,0.3)' }} onMouseOut={e => { if (!isBtnDisabled) e.currentTarget.style.background = 'rgba(239,68,68,0.2)' }}>
                                                <AlertTriangle size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '8px', marginTop: '-2px' }} />
                                                Destroy Existing Containers & Deploy Fresh Setup
                                            </button>
                                        </>
                                    );
                                })()}
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
                                <button disabled={role === "guest"} onClick={confirmRemoveAllContainers} style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: role === "guest" ? "not-allowed" : "pointer", opacity: role === "guest" ? 0.5 : 1, transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}>
                                    Remove Instances
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
                {/* States Popup Modal */}
                {statesPopup && createPortal(
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ background: 'var(--panel-bg)', width: '500px', maxWidth: '90vw', maxHeight: '80vh', border: '1px solid var(--panel-border)', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: '20px', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                                    {statesPopup.profile} Installed States ({statesPopup.states.length})
                                </h2>
                                <button onClick={() => setStatesPopup(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '18px' }}>X</button>
                            </div>
                            <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {statesPopup.states.map((sid: string) => {
                                    const state = US_STATES.find(s => s.id === sid);
                                    return state ? (
                                        <div key={sid} style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)', padding: '6px 12px', fontSize: '12px', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                                            {state.name}
                                        </div>
                                    ) : null;
                                })}
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        </>
    );
}
