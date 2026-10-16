import re

with open(r'c:\Code\OSRM 2\frontend\src\components\EngineSetup.tsx', 'r') as f:
    content = f.read()

# 1. Update State types
content = content.replace("const [selectedStates, setSelectedStates] = useState<string[]>([]);", 
                          "const [selectedStates, setSelectedStates] = useState<Record<string, string[]>>({ car: [], foot: [], nominatim: [], pelias: [] });\n    const [modalTab, setModalTab] = useState<'car' | 'foot' | 'nominatim' | 'pelias'>('car');")
content = content.replace("const [activeStates, setActiveStates] = useState<string[]>([]);",
                          "const [activeStates, setActiveStates] = useState<Record<string, string[]>>({ car: [], foot: [], nominatim: [], pelias: [] });")
content = content.replace("active_states?: string[]", "active_states?: any")

# 2. Update toggle logic in the modal
old_toggle = """    const toggleState = (sid: string) => {
        setSelectedStates(prev => prev.includes(sid) ? prev.filter(s => s !== sid) : [...prev, sid]);
    };"""
new_toggle = """    const toggleState = (sid: string) => {
        setSelectedStates(prev => {
            const currentTabStates = prev[modalTab] || [];
            if (currentTabStates.includes(sid)) {
                return { ...prev, [modalTab]: currentTabStates.filter(s => s !== sid) };
            } else {
                return { ...prev, [modalTab]: [...currentTabStates, sid] };
            }
        });
    };"""
content = content.replace(old_toggle, new_toggle)

# 3. Update activeStates loading logic
old_load = """                const data = await res.json();
                if (data.car) {
                    setDockerStatus(data);
                    if (data.active_states) setActiveStates(data.active_states);
                }"""
new_load = """                const data = await res.json();
                if (data.car) {
                    setDockerStatus(data);
                    if (data.active_states) {
                        if (Array.isArray(data.active_states)) {
                            setActiveStates({ car: data.active_states, foot: data.active_states, nominatim: data.active_states, pelias: data.active_states });
                        } else {
                            setActiveStates(data.active_states);
                        }
                    }
                }"""
content = content.replace(old_load, new_load)

# 4. Update the "Map Data Setup" display to show for each or just summarize
old_active_display = """                                {activeStates.length === 0 ? (
                                    <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>None (Not Configured)</div>
                                ) : (
                                    activeStates.map(sid => {
                                        const state = usStates.find(s => s.id === sid);
                                        return state ? (
                                            <div key={sid} style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', padding: '6px 12px', fontSize: '12px', fontWeight: 600 }}>
                                                {state.name}
                                            </div>
                                        ) : null;
                                    })
                                )}"""

new_active_display = """                                {Object.values(activeStates).every((v: any) => v.length === 0) ? (
                                    <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>None (Not Configured)</div>
                                ) : (
                                    Object.entries(activeStates).filter(([_, arr]: [any, any]) => arr.length > 0).map(([profile, sids]: [any, any]) => (
                                        <div key={profile} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-secondary)', width: '60px', fontWeight: 600 }}>{profile}</span>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                            {sids.map((sid: string) => {
                                                const state = usStates.find(s => s.id === sid);
                                                return state ? (
                                                    <div key={sid} style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', padding: '4px 8px', fontSize: '11px', fontWeight: 600 }}>
                                                        {state.name}
                                                    </div>
                                                ) : null;
                                            })}
                                            </div>
                                        </div>
                                    ))
                                )}"""
content = content.replace(old_active_display, new_active_display)

# 5. Modal Tabs UI and selection checkbox
old_step1 = """                    {/* Selection */}
                    <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
                        <h4 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)', fontSize: '16px' }}>Step 1: Select US States</h4>
                        
                        <div style={{ marginBottom: '16px' }}>
                            <input type="text" placeholder="Search states..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '10px 12px', background: 'var(--panel-inner-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', outline: 'none' }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                            {filteredStates.map(state => {
                                const isSelected = selectedStates.includes(state.id);"""

new_step1 = """                    {/* Selection */}
                    <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
                        <h4 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)', fontSize: '16px' }}>Step 1: Select US States per Engine</h4>
                        
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                            {['car', 'foot', 'nominatim', 'pelias'].map(t => (
                                <button key={t} onClick={() => setModalTab(t as any)} style={{ padding: '8px 16px', background: modalTab === t ? '#3b82f6' : 'var(--panel-inner-bg)', color: modalTab === t ? 'white' : 'var(--text-secondary)', border: '1px solid var(--panel-border)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>
                                    {t} ({(selectedStates as any)[t]?.length || 0})
                                </button>
                            ))}
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <input type="text" placeholder="Search states..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '10px 12px', background: 'var(--panel-inner-bg)', border: '1px solid var(--panel-border)', color: 'var(--text-primary)', outline: 'none' }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                            {filteredStates.map(state => {
                                const isSelected = (selectedStates[modalTab] || []).includes(state.id);"""
content = content.replace(old_step1, new_step1)

# 6. Button disabled logic
old_btn_dis = "disabled={selectedStates.length === 0}"
new_btn_dis = "disabled={Object.values(selectedStates).every((arr: any) => arr.length === 0)}"
content = content.replace(old_btn_dis, new_btn_dis)

with open(r'c:\Code\OSRM 2\frontend\src\components\EngineSetup.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Frontend patch complete")
