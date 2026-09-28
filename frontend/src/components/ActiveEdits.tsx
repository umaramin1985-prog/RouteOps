import { useState, useEffect, useMemo } from 'react';
import { Trash2, Search, ChevronLeft, ChevronRight, Map } from 'lucide-react';
import stateBounds from '../stateBounds.json';

export default function ActiveEdits({ activeStates = [] }: { activeStates?: string[] }) {
    const [activeOverrides, setActiveOverrides] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [overrideToRemove, setOverrideToRemove] = useState<number | null>(null);
    
    // Pagination and Search state
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStateFilter, setSelectedStateFilter] = useState<string>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 24; // 24 items per page fits well in a grid

    const fetchOverrides = async () => {
        try {
            const res = await fetch('http://localhost:8000/overrides', { cache: 'no-store' });
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
        const handleUpdate = () => {
            if (window.location.hash.replace('#', '') === 'edits' || event?.type === 'edit-applied') {
                fetchOverrides();
            }
        };
        window.addEventListener('hashchange', handleUpdate);
        window.addEventListener('edit-applied', handleUpdate);
        return () => {
            window.removeEventListener('hashchange', handleUpdate);
            window.removeEventListener('edit-applied', handleUpdate);
        };
    }, []);

    const confirmRemove = (id: number) => {
        setOverrideToRemove(id);
    };

    const proceedRemove = async () => {
        if (overrideToRemove === null) return;
        try {
            const res = await fetch(`http://localhost:8000/overrides/${overrideToRemove}`, { method: 'DELETE' });
            if (res.ok) {
                fetchOverrides();
                window.dispatchEvent(new Event('edit-removed'));
            }
        } catch(err) {
            console.error(err);
        } finally {
            setOverrideToRemove(null);
        }
    };

    const goToMap = (ov: any) => {
        window.location.hash = '#map';
        // Add a slight delay to ensure the map tab renders before firing the event
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('map-goto', { detail: ov }));
        }, 50);
    };

    // Filter and paginate data
    const filteredOverrides = useMemo(() => {
        return activeOverrides.filter(ov => {
            const term = searchTerm.toLowerCase();
            const matchesSearch = (
                (ov.reason && ov.reason.toLowerCase().includes(term)) ||
                (ov.road_name && ov.road_name.toLowerCase().includes(term)) ||
                (ov.city_name && ov.city_name.toLowerCase().includes(term)) ||
                ov.from_node.toLowerCase().includes(term) ||
                ov.to_node.toLowerCase().includes(term) ||
                (ov.is_closed ? 'closed' : 'speed').includes(term)
            );

            let matchesState = true;
            if (selectedStateFilter !== 'all' && ov.lat !== null && ov.lng !== null) {
                const bounds = (stateBounds as any)[selectedStateFilter];
                if (bounds) {
                    const minLat = Math.min(bounds[0][0], bounds[1][0]);
                    const maxLat = Math.max(bounds[0][0], bounds[1][0]);
                    const minLng = Math.min(bounds[0][1], bounds[1][1]);
                    const maxLng = Math.max(bounds[0][1], bounds[1][1]);
                    matchesState = ov.lat >= minLat && ov.lat <= maxLat && ov.lng >= minLng && ov.lng <= maxLng;
                }
            }

            return matchesSearch && matchesState;
        });
    }, [activeOverrides, searchTerm, selectedStateFilter]);

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
        <div className="animate-fade-in" style={{ padding: '0', width: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <h2 style={{ margin: 0, fontWeight: 600, fontSize: '1.5rem', color: 'var(--text-primary)' }}>Active Route Edits</h2>
                    <span style={{ background: 'var(--panel-border)', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {filteredOverrides.length} {filteredOverrides.length === 1 ? 'Edit' : 'Edits'}
                    </span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', width: '220px' }}>
                        <select
                            value={selectedStateFilter}
                            onChange={(e) => setSelectedStateFilter(e.target.value)}
                            style={{ width: '100%', padding: '10px 16px', paddingRight: '40px', borderRadius: '8px', border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none', appearance: 'none', cursor: 'pointer', fontSize: '14px' }}
                        >
                            <option value="all">All Active States</option>
                            {activeStates.map(s => (
                                <option key={s} value={s}>{s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}</option>
                            ))}
                        </select>
                        <ChevronRight size={16} style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%) rotate(90deg)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
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
            </div>

            {filteredOverrides.length === 0 ? (
                <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    {searchTerm ? 'No route edits match your search.' : 'No active route edits found in the database.'}
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px', alignItems: 'flex-start', overflowY: 'auto', paddingRight: '8px', paddingBottom: '24px', flex: 1 }} className="custom-scrollbar">
                        {currentData.map(ov => (
                            <div key={ov.id} onClick={() => goToMap(ov)} className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', cursor: 'pointer' }}>
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
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); confirmRemove(ov.id); }}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 600, padding: '4px' }}
                                            title="Remove this edit"
                                        >
                                            <Trash2 size={16} /> Remove
                                        </button>
                                    </div>
                                </div>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {ov.reason && <div style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.5' }}>{ov.reason}</div>}
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '12px', background: 'var(--input-bg)', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--input-border)', display: 'inline-flex', alignItems: 'center', gap: '6px', alignSelf: 'flex-start' }}>
                                        <Map size={14} /> 
                                        {ov.road_name ? <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{ov.road_name}{ov.city_name ? `, ${ov.city_name}` : ''}</span> : (ov.lat && ov.lng ? `${ov.lat.toFixed(4)}, ${ov.lng.toFixed(4)}${ov.city_name ? ` in ${ov.city_name}` : ''}` : 'Custom Route Segment')}
                                    </div>
                                </div>
                                
                                {ov.created_at && (
                                    <div style={{ paddingTop: '16px', borderTop: '1px solid var(--panel-border)', fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
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

            {/* Custom Confirmation Modal */}
            {overrideToRemove !== null && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999
                }}>
                    <div className="glass-panel" style={{ padding: '24px', width: '320px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '16px' }}>Remove Edit</h3>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.5' }}>
                            Are you sure you want to remove this edit? This will trigger a background rebuild of the route data.
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                            <button 
                                onClick={(e) => { e.stopPropagation(); setOverrideToRemove(null); }}
                                style={{ background: 'transparent', border: '1px solid var(--input-border)', color: 'var(--text-primary)', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, transition: 'all 0.2s' }}
                                onMouseOver={(e) => e.currentTarget.style.background = 'var(--divider-bg)'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); proceedRemove(); }}
                                style={{ background: 'var(--danger)', border: 'none', color: 'white', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, transition: 'all 0.2s' }}
                                onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                                onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                            >
                                Remove
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
