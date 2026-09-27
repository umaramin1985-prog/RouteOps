import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Map, Lock, User, ArrowRight } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === 'admin' && password === 'admin') {
      navigate('/dashboard');
    } else {
      setError('Invalid username or password');
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
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

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div style={{ position: 'relative' }}>
            <User size={18} style={{ position: 'absolute', top: '14px', left: '16px', color: 'var(--text-secondary)' }} />
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
            <Lock size={18} style={{ position: 'absolute', top: '14px', left: '16px', color: 'var(--text-secondary)' }} />
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
        </form>
      </div>
    </div>
  );
}
