import re

with open('frontend/src/components/MapDisplay.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Add states
states_str = """  const [activeEngine, setActiveEngine] = useState<'osrm' | 'nominatim' | 'pelias'>('osrm');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [geocodePins, setGeocodePins] = useState<L.LatLng[]>([]);
"""
content = content.replace("  const [copiedEnd, setCopiedEnd] = useState<boolean>(false);", "  const [copiedEnd, setCopiedEnd] = useState<boolean>(false);\n" + states_str)

# Add handleSearch
search_logic = """  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setRouteError(null);
    setSearchResults([]);
    setGeocodePins([]);
    
    try {
        if (activeEngine === 'nominatim') {
            const port = dockerStatus?.nominatim_port || 5003;
            const res = await fetch(`http://${window.location.hostname}:${port}/search?q=${encodeURIComponent(searchQuery)}&format=json`);
            const data = await res.json();
            if (data && data.length > 0) {
                setSearchResults(data);
                const bounds = L.latLngBounds(data.map((item: any) => [parseFloat(item.lat), parseFloat(item.lon)]));
                setRouteBounds(bounds);
                setGeocodePins(data.map((item: any) => L.latLng(parseFloat(item.lat), parseFloat(item.lon))));
            } else {
                setRouteError('No results found from Nominatim.');
            }
        } else if (activeEngine === 'pelias') {
            const port = dockerStatus?.pelias_port || 5002;
            const res = await fetch(`http://${window.location.hostname}:${port}/v1/autocomplete?text=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            if (data && data.features && data.features.length > 0) {
                setSearchResults(data.features);
                const bounds = L.latLngBounds(data.features.map((item: any) => [item.geometry.coordinates[1], item.geometry.coordinates[0]]));
                setRouteBounds(bounds);
                setGeocodePins(data.features.map((item: any) => L.latLng(item.geometry.coordinates[1], item.geometry.coordinates[0])));
            } else {
                setRouteError('No results found from Pelias.');
            }
        }
    } catch (e) {
        setRouteError(`Failed to connect to ${activeEngine}.`);
    }
    setIsSearching(false);
  };
"""
content = content.replace("  const showToast = (msg: string) => {", search_logic + "\n  const showToast = (msg: string) => {")

# Map click
content = content.replace("""  const handleMapClick = (latlng: L.LatLng) => {
    setRouteError(null);""", """  const handleMapClick = (latlng: L.LatLng) => {
    setRouteError(null);
    if (activeEngine !== 'osrm') return;""")

# Add pins
content = content.replace("{endPoint && <Marker position={endPoint} icon={endIcon}><Popup>End</Popup></Marker>}", """{endPoint && <Marker position={endPoint} icon={endIcon}><Popup>End</Popup></Marker>}
        {activeEngine !== 'osrm' && geocodePins.map((pin, i) => <Marker key={`pin-${i}`} position={pin} icon={endIcon} />)}""")

# Add Engine Tabs and condtional rendering
tabs_ui = """        {/* Engine Tabs */}
        <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 0, padding: '4px', border: '1px solid var(--input-border)', marginBottom: '4px' }}>
            <button 
                onClick={() => { setActiveEngine('osrm'); setRouteError(null); setRouteBounds(null); }}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 0, border: 'none', background: activeEngine === 'osrm' ? '#3b82f6' : 'transparent', color: activeEngine === 'osrm' ? 'white' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', fontWeight: activeEngine === 'osrm' ? 600 : 500, transition: 'all 0.2s', boxShadow: activeEngine === 'osrm' ? '0 2px 10px rgba(59,130,246,0.3)' : 'none' }}
            >OSRM (Route)</button>
            <button 
                onClick={() => { setActiveEngine('nominatim'); setRouteError(null); setRouteBounds(null); }}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 0, border: 'none', background: activeEngine === 'nominatim' ? '#8b5cf6' : 'transparent', color: activeEngine === 'nominatim' ? 'white' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', fontWeight: activeEngine === 'nominatim' ? 600 : 500, transition: 'all 0.2s', boxShadow: activeEngine === 'nominatim' ? '0 2px 10px rgba(139,92,246,0.3)' : 'none' }}
            >Nominatim</button>
            <button 
                onClick={() => { setActiveEngine('pelias'); setRouteError(null); setRouteBounds(null); }}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 0, border: 'none', background: activeEngine === 'pelias' ? '#10b981' : 'transparent', color: activeEngine === 'pelias' ? 'white' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', fontWeight: activeEngine === 'pelias' ? 600 : 500, transition: 'all 0.2s', boxShadow: activeEngine === 'pelias' ? '0 2px 10px rgba(16,185,129,0.3)' : 'none' }}
            >Pelias</button>
        </div>
"""

content = content.replace("        {/* Start Input */}", tabs_ui + "\n        {activeEngine === 'osrm' ? (\n        <>\n        {/* Start Input */}")

# Search bar logic for Geocoding
geocoding_ui = """        </>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--input-bg)', borderRadius: 0, border: '1px solid var(--input-border)', padding: '4px 12px' }}>
                <input 
                    type="text" 
                    placeholder="Search address or place..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSearch();
                    }}
                    style={{ flex: 1, background: 'transparent', border: 'none', padding: '8px 0', color: 'var(--text-primary)', outline: 'none', fontSize: '13px' }}
                />
                <button 
                    onClick={handleSearch} 
                    style={{ background: 'transparent', border: 'none', color: '#3b82f6', cursor: 'pointer', fontWeight: 600, padding: '4px' }}
                >
                    {isSearching ? '...' : 'Search'}
                </button>
            </div>
            {searchResults.length > 0 && (
                <div className="custom-scrollbar" style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', maxHeight: '300px', overflowY: 'auto' }}>
                    {searchResults.map((res, i) => {
                        const name = activeEngine === 'nominatim' ? res.display_name : res.properties?.label;
                        return (
                            <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid var(--panel-border)', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => {
                                const lat = activeEngine === 'nominatim' ? parseFloat(res.lat) : res.geometry.coordinates[1];
                                const lng = activeEngine === 'nominatim' ? parseFloat(res.lon) : res.geometry.coordinates[0];
                                setRouteBounds(L.latLngBounds([lat, lng], [lat, lng]));
                            }}>
                                <span style={{ flex: 1 }}>{name}</span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
        )}"""

content = content.replace("      {/* Edit Speed Modal */}", geocoding_ui + "\n      {/* Edit Speed Modal */}")

with open('frontend/src/components/MapDisplay.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
