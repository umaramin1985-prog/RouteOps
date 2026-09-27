import { useState, useEffect } from 'react';
import { LogOut, Settings, Map as MapIcon, Activity, AlertTriangle, Maximize, Minimize, Sun, Moon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import MapDisplay from './MapDisplay';
import EngineSetup from './EngineSetup';

export default function Dashboard() {
  const navigate = useNavigate();
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [activeTab, setActiveTab] = useState('setup');
  const [dockerStatus, setDockerStatus] = useState<{car: string, foot: string, active_states?: string[]} | null>(null);
  const [dbStatus, setDbStatus] = useState<string | null>(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg('');
    try {
      const res = await fetch('http://localhost:8000/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', old_password: oldPassword, new_password: newPassword })
      });
      if (res.ok) {
        setPasswordMsg('Password changed successfully!');
        setOldPassword('');
        setNewPassword('');
        setTimeout(() => setShowChangePassword(false), 2000);
      } else {
        const data = await res.json();
        setPasswordMsg(data.detail || 'Invalid old password');
      }
    } catch (err) {
      setPasswordMsg('Unable to connect to server');
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const fetchDocker = async () => {
        try {
            const res = await fetch('http://localhost:8000/system/docker');
            if (res.ok) {
                const data = await res.json();
                setDockerStatus(data);
            }
        } catch (e) {}
        try {
            const resDb = await fetch('http://localhost:8000/system/db-status');
            if (resDb.ok) {
                const dbData = await resDb.json();
                setDbStatus(dbData.status);
            } else {
                setDbStatus('disconnected');
            }
        } catch (e) {
            setDbStatus('disconnected');
        }
    };
    fetchDocker();
    const interval = setInterval(fetchDocker, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', padding: isFullScreen ? '0' : '20px 0', gap: isFullScreen ? '0' : '20px', boxSizing: 'border-box' }}>
      
      {/* Header */}
      {!isFullScreen && (
      <header className="glass-panel" style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '12px 24px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ background: 'var(--accent-color)', padding: '8px', borderRadius: 0, color: 'white' }}>
            <MapIcon size={24} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>RouteOps</h2>
          </div>
        </div>

        <nav style={{ display: 'flex', gap: '2rem' }}>
          <button onClick={() => setActiveTab('setup')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: activeTab === 'setup' ? 'var(--accent-color)' : 'var(--text-secondary)', fontWeight: activeTab === 'setup' ? 600 : 500, fontSize: '1rem', transition: '0.2s' }}>
            <Settings size={18} />
            Engines Setup
          </button>
          <button onClick={() => setActiveTab('map')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: activeTab === 'map' ? 'var(--accent-color)' : 'var(--text-secondary)', fontWeight: activeTab === 'map' ? 600 : 500, fontSize: '1rem' }}>
            <Activity size={18} />
            Live Map
          </button>
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingRight: '1rem', borderRight: '1px solid var(--panel-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="blink" style={{ width: '8px', height: '8px', borderRadius: '50%', '--current-color': dbStatus === 'connected' ? 'var(--success)' : 'var(--danger)', border: '1px solid var(--current-color)' } as React.CSSProperties}></div>
                <span style={{ fontSize: '0.9rem' }}>DB: {dbStatus === 'connected' ? 'Connected' : 'Offline'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="blink" style={{ width: '8px', height: '8px', borderRadius: '50%', '--current-color': dockerStatus?.car === 'running' ? 'var(--success)' : 'var(--danger)', border: '1px solid var(--current-color)' } as React.CSSProperties}></div>
                <span style={{ fontSize: '0.9rem' }}>Car: {dockerStatus?.car === 'running' ? 'Active' : 'Offline'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div className="blink" style={{ width: '8px', height: '8px', borderRadius: '50%', '--current-color': dockerStatus?.foot === 'running' ? 'var(--success)' : 'var(--danger)', border: '1px solid var(--current-color)' } as React.CSSProperties}></div>
                <span style={{ fontSize: '0.9rem' }}>Foot: {dockerStatus?.foot === 'running' ? 'Active' : 'Offline'}</span>
              </div>
            </div>
            <button 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button 
              onClick={() => {
                setShowChangePassword(true);
                setPasswordMsg('');
              }} 
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'Outfit' }}
              title="Change Password"
            >
              <Settings size={18} />
            </button>
            <button 
              onClick={() => {
                localStorage.removeItem('isAuthenticated');
                navigate('/');
              }} 
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'Outfit' }}
            >
              <LogOut size={18} />
              Sign Out
            </button>
        </div>
      </header>
      )}

      {/* Main Content Area */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', borderRadius: 0, overflow: 'hidden', minHeight: 0 }}>
        {activeTab === 'map' && (
          <button 
            onClick={() => setIsFullScreen(!isFullScreen)}
            style={{
              position: 'absolute', top: '20px', right: '20px', zIndex: 1001,
              width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--panel-bg)', backdropFilter: 'blur(16px)', border: '1px solid var(--panel-border)',
              color: 'white', borderRadius: 0, cursor: 'pointer', transition: 'all 0.2s',
              boxShadow: '0 4px 15px rgba(0,0,0,0.3)'
            }}
            title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
            onMouseOver={(e) => e.currentTarget.style.background = 'var(--accent-color)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'var(--panel-bg)'}
          >
            {isFullScreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        )}

        <div className="animate-fade-in" style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ display: activeTab === 'map' ? 'block' : 'none', height: '100%' }}>
            <MapDisplay activeStates={dockerStatus?.active_states || []} />
          </div>
          <div style={{ display: activeTab === 'setup' ? 'block' : 'none', height: '100%' }}>
            <EngineSetup />
          </div>
        </div>
      </div>

      {/* Footer */}
      {!isFullScreen && (
      <footer className="glass-panel" style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        padding: '12px 24px',
        fontSize: '0.85rem',
        color: 'var(--text-secondary)'
      }}>
        <span>&copy; {new Date().getFullYear()} OSRM Admin Portal. All rights reserved.</span>
      </footer>
      )}

      {/* Change Password Modal */}
      {showChangePassword && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel animate-fade-in" style={{ padding: '24px', width: '400px', position: 'relative' }}>
            <h3 style={{ marginBottom: '16px' }}>Change Password</h3>
            {passwordMsg && <div style={{ padding: '8px', marginBottom: '16px', background: passwordMsg.includes('success') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: passwordMsg.includes('success') ? '#86efac' : '#fca5a5', fontSize: '0.9rem', borderRadius: '4px' }}>{passwordMsg}</div>}
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <input type="password" placeholder="Current Password" required value={oldPassword} onChange={e => setOldPassword(e.target.value)} className="input-field" style={{ padding: '8px 12px' }} />
              <input type="password" placeholder="New Password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="input-field" style={{ padding: '8px 12px' }} />
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button type="button" onClick={() => setShowChangePassword(false)} style={{ background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ padding: '8px 16px' }}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
