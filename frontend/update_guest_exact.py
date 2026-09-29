import os

# EngineSetup.tsx
with open('src/components/EngineSetup.tsx', 'r', encoding='utf-8') as f:
    es = f.read()

if "const role =" not in es:
    es = es.replace('export default function EngineSetup() {', "export default function EngineSetup() {\n    const role = localStorage.getItem('role') || 'admin';")

es = es.replace(
    '<button onClick={() => { setSelectedStates(activeStates); setShowModal(true); }}',
    '<button disabled={role === "guest"} onClick={() => { setSelectedStates(activeStates); setShowModal(true); }}'
)
es = es.replace(
    '<button onClick={handleRemoveAllContainers}',
    '<button disabled={role === "guest"} onClick={handleRemoveAllContainers}'
)
es = es.replace(
    '<button disabled={dockerStatus?.car === \'Not Found\'} onClick={() => handleDockerAction(\'car\'',
    '<button disabled={role === "guest" || dockerStatus?.car === \'Not Found\'} onClick={() => handleDockerAction(\'car\''
)
es = es.replace(
    '<button disabled={dockerStatus?.foot === \'Not Found\'} onClick={() => handleDockerAction(\'foot\'',
    '<button disabled={role === "guest" || dockerStatus?.foot === \'Not Found\'} onClick={() => handleDockerAction(\'foot\''
)
es = es.replace(
    '<button onClick={handleDeploy}',
    '<button disabled={role === "guest"} onClick={handleDeploy}'
)
es = es.replace(
    '<button onClick={confirmRemoveAllContainers}',
    '<button disabled={role === "guest"} onClick={confirmRemoveAllContainers}'
)
es = es.replace(
    '<button onClick={() => setSelectedStates([])}',
    '<button disabled={role === "guest"} onClick={() => setSelectedStates([])}'
)

# Visually disable buttons in EngineSetup
es = es.replace(
    'cursor: dockerStatus?.car === \'Not Found\' ? \'not-allowed\' : \'pointer\'',
    'cursor: role === "guest" || dockerStatus?.car === \'Not Found\' ? \'not-allowed\' : \'pointer\', opacity: role === "guest" ? 0.5 : 1'
)
es = es.replace(
    'cursor: dockerStatus?.foot === \'Not Found\' ? \'not-allowed\' : \'pointer\'',
    'cursor: role === "guest" || dockerStatus?.foot === \'Not Found\' ? \'not-allowed\' : \'pointer\', opacity: role === "guest" ? 0.5 : 1'
)

# Replace cursor: 'pointer' with opacity and not-allowed for other buttons if guest
es = es.replace(
    'cursor: \'pointer\', transition: \'background 0.2s\', marginBottom: \'16px\'',
    'cursor: role === "guest" ? "not-allowed" : "pointer", opacity: role === "guest" ? 0.5 : 1, transition: \'background 0.2s\', marginBottom: \'16px\''
)
es = es.replace(
    'cursor: \'pointer\', transition: \'all 0.2s\', borderRadius: 0',
    'cursor: role === "guest" ? "not-allowed" : "pointer", opacity: role === "guest" ? 0.5 : 1, transition: \'all 0.2s\', borderRadius: 0'
)
es = es.replace(
    'cursor: \'pointer\', transition: \'all 0.2s\'',
    'cursor: role === "guest" ? "not-allowed" : "pointer", opacity: role === "guest" ? 0.5 : 1, transition: \'all 0.2s\''
)

with open('src/components/EngineSetup.tsx', 'w', encoding='utf-8') as f:
    f.write(es)

# ActiveEdits.tsx
with open('src/components/ActiveEdits.tsx', 'r', encoding='utf-8') as f:
    ae = f.read()

if "const role =" not in ae:
    ae = ae.replace('export default function ActiveEdits({ activeStates = [] }: { activeStates?: string[] }) {', "export default function ActiveEdits({ activeStates = [] }: { activeStates?: string[] }) {\n    const role = localStorage.getItem('role') || 'admin';")

ae = ae.replace(
    '<button \n                                            onClick={(e) => { e.stopPropagation(); confirmRemove(ov.id); }}\n                                            style={{ background: \'transparent\', border: \'none\', color: \'var(--danger)\', cursor: \'pointer\', display: \'flex\', alignItems: \'center\', gap: \'4px\', fontSize: \'12px\', fontWeight: 600, padding: \'4px\' }}',
    '<button \n                                            disabled={role === "guest"}\n                                            onClick={(e) => { e.stopPropagation(); confirmRemove(ov.id); }}\n                                            style={{ background: \'transparent\', border: \'none\', color: role === "guest" ? \'var(--text-secondary)\' : \'var(--danger)\', cursor: role === "guest" ? "not-allowed" : \'pointer\', display: \'flex\', alignItems: \'center\', gap: \'4px\', fontSize: \'12px\', fontWeight: 600, padding: \'4px\' }}'
)
ae = ae.replace(
    '<button \n                                onClick={(e) => { e.stopPropagation(); proceedRemove(); }}\n                                style={{ background: \'var(--danger)\', border: \'none\', color: \'white\', padding: \'6px 16px\', borderRadius: \'4px\', cursor: \'pointer\', fontSize: \'13px\', fontWeight: 600, transition: \'all 0.2s\' }}',
    '<button \n                                disabled={role === "guest"}\n                                onClick={(e) => { e.stopPropagation(); proceedRemove(); }}\n                                style={{ background: \'var(--danger)\', border: \'none\', color: \'white\', padding: \'6px 16px\', borderRadius: \'4px\', cursor: role === "guest" ? "not-allowed" : \'pointer\', fontSize: \'13px\', fontWeight: 600, transition: \'all 0.2s\', opacity: role === "guest" ? 0.5 : 1 }}'
)

with open('src/components/ActiveEdits.tsx', 'w', encoding='utf-8') as f:
    f.write(ae)

# MapDisplay.tsx
with open('src/components/MapDisplay.tsx', 'r', encoding='utf-8') as f:
    md = f.read()

if "const role =" not in md:
    md = md.replace('export default function MapDisplay() {', "export default function MapDisplay() {\n    const role = localStorage.getItem('role') || 'admin';")

md = md.replace(
    '<button onClick={applyClosure}',
    '<button disabled={role === "guest"} onClick={applyClosure}'
)
md = md.replace(
    '<button onClick={applySpeedLimit}',
    '<button disabled={role === "guest"} onClick={applySpeedLimit}'
)
md = md.replace(
    '<button onClick={revertOverride}',
    '<button disabled={role === "guest"} onClick={revertOverride}'
)

md = md.replace(
    'cursor: \'pointer\', transition: \'opacity 0.2s\'',
    'cursor: role === "guest" ? "not-allowed" : "pointer", transition: \'opacity 0.2s\', opacity: role === "guest" ? 0.5 : 1'
)

with open('src/components/MapDisplay.tsx', 'w', encoding='utf-8') as f:
    f.write(md)
