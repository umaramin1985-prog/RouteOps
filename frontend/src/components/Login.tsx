import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Map, Lock, User, ArrowRight, Key } from 'lucide-react';
import packageJson from '../../package.json';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        localStorage.setItem('isAuthenticated', 'true');
        localStorage.setItem('role', 'admin');
        navigate('/dashboard');
      } else {
        const data = await res.json();
        setError(data.detail || 'Invalid username or password');
      }
    } catch (err) {
      setError('Unable to connect to the server');
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/auth/recover-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, recovery_code: recoveryCode, new_password: newPassword })
      });
      if (res.ok) {
        setSuccessMsg('Password recovered successfully! Please sign in.');
        setMode('login');
        setPassword('');
      } else {
        const data = await res.json();
        setError(data.detail || 'Invalid recovery code');
      }
    } catch (err) {
      setError('Unable to connect to the server');
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh', 
      alignItems: 'center', 
      justifyContent: 'center',
      backgroundImage: 'var(--login-bg)',
      backgroundSize: 'cover',
      backgroundPosition: 'center'
    }}>
      <div className="glass-panel animate-fade-in" style={{ padding: '3rem', width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ 
            background: 'rgba(59, 130, 246, 0.2)', 
            width: '64px', height: '64px', 
            borderRadius: 0, 
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem',
            color: 'var(--accent-color)'
          }}>
            <Map size={32} />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>RouteOps</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Transportation Management</p>
        </div>

        {error && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#fca5a5', padding: '10px', marginBottom: '1.5rem', border: '1px solid #fca5a5', fontSize: '13px', textAlign: 'center' }}>
                {error}
            </div>
        )}
        {successMsg && (
            <div style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#86efac', padding: '10px', marginBottom: '1.5rem', border: '1px solid #86efac', fontSize: '13px', textAlign: 'center' }}>
                {successMsg}
            </div>
        )}

        {mode === 'login' ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '16px', color: 'var(--text-secondary)' }} />
              <input 
                type="text" 
                placeholder="Username" 
                className="input-field"
                style={{ paddingLeft: '44px' }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '16px', color: 'var(--text-secondary)' }} />
              <input 
                type="password" 
                placeholder="Password" 
                className="input-field"
                style={{ paddingLeft: '44px' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
              Sign In <ArrowRight size={18} />
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button type="button" onClick={() => { setMode('forgot'); setError(''); setSuccessMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontSize: '0.9rem' }}>
                Forgot Password?
                </button>
                <button type="button" onClick={() => {
                    localStorage.setItem('isAuthenticated', 'true');
                    localStorage.setItem('role', 'guest');
                    navigate('/dashboard');
                }} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem', textDecoration: 'underline' }}>
                Guest Login
                </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRecover} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '16px', color: 'var(--text-secondary)' }} />
              <input 
                type="text" 
                placeholder="Username" 
                className="input-field"
                style={{ paddingLeft: '44px' }}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div style={{ position: 'relative' }}>
              <Key size={18} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '16px', color: 'var(--text-secondary)' }} />
              <input 
                type="text" 
                placeholder="Recovery Code (default: 123456)" 
                className="input-field"
                style={{ paddingLeft: '44px' }}
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                required
              />
            </div>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '16px', color: 'var(--text-secondary)' }} />
              <input 
                type="password" 
                placeholder="New Password" 
                className="input-field"
                style={{ paddingLeft: '44px' }}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
              Reset Password
            </button>
            <button type="button" onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.9rem' }}>
              Back to Login
            </button>
          </form>
        )}
      </div>

      <footer style={{
        position: 'absolute',
        bottom: 0,
        width: '100%',
        textAlign: 'center',
        padding: '12px',
        color: 'rgba(255,255,255,0.5)',
        fontSize: '11px',
        background: 'rgba(0,0,0,0.3)'
      }}>
        <span>&copy; {new Date().getFullYear()} IT Curves | RouteOps Admin. All rights reserved. &nbsp;|&nbsp; Version {packageJson.version}</span>
      </footer>
    </div>
  );
}
