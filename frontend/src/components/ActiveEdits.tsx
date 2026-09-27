import { useState, useEffect, useMemo } from 'react';
import { Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';

export default function ActiveEdits() {
    const [activeOverrides, setActiveOverrides] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Pagination and Search state
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 24; // 24 items per page fits well in a grid

    const fetchOverrides = async () => {
        try {
            const res = await fetch('http://localhost:8000/overrides');
            const data = await res.json();
            // Sort by created_at descending (newest first)
            data.sort((a: any, b: any) => new Date(b.created_at + 'Z').getTime() - new Date(a.created_at + 'Z').getTime());
            setActiveOverrides(data);
        } catch(err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOverrides();
    }, []);

    const revertOverride = async (id: number) => {
        if (!confirm('Are you sure you want to remove this edit? This will trigger a background rebuild.')) return;
        try {
            const res = await fetch(`http://localhost:8000/overrides/${id}`, { method: 'DELETE' });
            if (res.ok) {
                fetchOverrides();
            }
        } catch(err) {
            console.error(err);
        }
    };

    // Filter and paginate data
    const filteredOverrides = useMemo(() => {
        return activeOverrides.filter(ov => {
            const term = searchTerm.toLowerCase();
            return (
                (ov.reason && ov.reason.toLowerCase().includes(term)) ||
                ov.from_node.toLowerCase().includes(term) ||
                ov.to_node.toLowerCase().includes(term) ||
                (ov.is_closed ? 'closed' : 'speed').includes(term)
            );
        });
    }, [activeOverrides, searchTerm]);

    const totalPages = Math.ceil(filteredOverrides.length / ITEMS_PER_PAGE);
    const currentData = useMemo(() => {
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return filteredOverrides.slice(start, start + ITEMS_PER_PAGE);
    }, [filteredOverrides, currentPage]);

    // Reset to page 1 when search changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm]);

    if (loading) return <div style={{ padding: '24px', color: 'var(--text-secondary)' }}>Loading edits...</div>;

    return (
        <div className="animate-fade-in" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <h2 style={{ margin: 0, fontWeight: 600, fontSize: '1.5rem', color: 'var(--text-primary)' }}>Active Route Edits</h2>
                    <span style={{ background: 'var(--panel-border)', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {filteredOverrides.length} {filteredOverrides.length === 1 ? 'Edit' : 'Edits'}
                    </span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: '8px', padding: '6px 12px', width: '300px' }}>
                    <Search size={16} color="var(--text-secondary)" style={{ marginRight: '8px' }} />
                    <input 
                        type="text" 
                        placeholder="Search by reason, node ID, or status..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', width: '100%', fontSize: '13px' }}
                    />
                </div>
            </div>

            {filteredOverrides.length === 0 ? (
                <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    {searchTerm ? 'No route edits match your search.' : 'No active route edits found in the database.'}
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px', overflowY: 'auto', paddingRight: '8px', paddingBottom: '24px', flex: 1 }} className="custom-scrollbar">
                        {currentData.map(ov => (
                            <div key={ov.id} className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span style={{ 
                                            padding: '4px 8px', 
                                            background: ov.is_closed ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)', 
                                            color: ov.is_closed ? '#ef4444' : '#f59e0b', 
                                            borderRadius: '4px', 
                                            fontSize: '12px', 
                                            fontWeight: 700 
                                        }}>
                                            {ov.is_closed ? 'CLOSED' : `${Math.round(ov.speed_kmh / 1.60934)} MPH`}
                                        </span>
                                    </div>
                                    <button 
                                        onClick={() => revertOverride(ov.id)}
                                        style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, padding: '4px' }}
                                        title="Remove this edit"
                                    >
                                        <Trash2 size={16} /> Remove
                                    </button>
                                </div>
                                
                                <div>
                                    {ov.reason && <div style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>{ov.reason}</div>}
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '12px', wordBreak: 'break-all', fontFamily: 'monospace', background: 'var(--input-bg)', padding: '8px', borderRadius: '4px', border: '1px solid var(--input-border)' }}>
                                        {ov.from_node} &rarr; {ov.to_node}
                                    </div>
                                </div>
                                
                                {ov.created_at && (
                                    <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--panel-border)', fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span>Applied on: {new Date(ov.created_at + 'Z').toLocaleString()}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--panel-border)' }}>
                            <button 
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: currentPage === 1 ? 'var(--text-secondary)' : 'var(--text-primary)', padding: '6px 12px', borderRadius: '4px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                <ChevronLeft size={16} /> Previous
                            </button>
                            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                Page <strong style={{ color: 'var(--text-primary)' }}>{currentPage}</strong> of <strong>{totalPages}</strong>
                            </span>
                            <button 
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: currentPage === totalPages ? 'var(--text-secondary)' : 'var(--text-primary)', padding: '6px 12px', borderRadius: '4px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                Next <ChevronRight size={16} />
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
