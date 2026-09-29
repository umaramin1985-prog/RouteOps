import os, re

def update_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Inject role variable inside the component definition if not exists
    if "const role = localStorage.getItem('role')" not in content:
        # For EngineSetup
        content = re.sub(
            r'(export default function \w+\(.*?\)\s*\{)',
            r"\1\n    const role = localStorage.getItem('role') || 'admin';",
            content
        )
    
    # Disable buttons globally for EngineSetup.tsx
    if 'EngineSetup.tsx' in filepath:
        # Simple buttons
        content = re.sub(
            r'(<button\s+)(onClick=\{)',
            r'\1disabled={role === "guest"} \2',
            content
        )
        # Buttons with existing disabled prop
        content = re.sub(
            r'(<button\s+disabled=\{)(.+?)(\}\s+onClick=)',
            r'\1role === "guest" || (\2)\3',
            content
        )

    # Disable remove button in ActiveEdits.tsx
    if 'ActiveEdits.tsx' in filepath:
        content = re.sub(
            r'(<button\s+onClick=\{.*setOverrideToRemove)',
            r'<button disabled={role === "guest"} onClick={', # wait, regex might be tricky
            content
        )
        # Let's just disable buttons that have a destructive action or set state that guest shouldn't.
        # Active edits has a trash button.
        content = content.replace(
            '<button onClick={() => setOverrideToRemove(override.id)}',
            '<button disabled={role === "guest"} onClick={() => setOverrideToRemove(override.id)}'
        )
        content = content.replace(
            '<button onClick={() => setOverrideToRemove(null)}',
            '<button disabled={role === "guest"} onClick={() => setOverrideToRemove(null)}'
        )
        content = content.replace(
            '<button onClick={handleRemoveOverride}',
            '<button disabled={role === "guest"} onClick={handleRemoveOverride}'
        )

    # MapDisplay.tsx
    if 'MapDisplay.tsx' in filepath:
        # Disable editing map: wait, clicking map opens "Close Road" / "Speed Limit"
        # we can disable the map clicks or disable the Apply button.
        content = content.replace(
            '<button onClick={applySpeedLimit}',
            '<button disabled={role === "guest"} onClick={applySpeedLimit}'
        )
        content = content.replace(
            '<button onClick={applyClosure}',
            '<button disabled={role === "guest"} onClick={applyClosure}'
        )
        content = content.replace(
            '<button onClick={revertOverride}',
            '<button disabled={role === "guest"} onClick={revertOverride}'
        )
        
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

update_file('./src/components/EngineSetup.tsx')
update_file('./src/components/ActiveEdits.tsx')
update_file('./src/components/MapDisplay.tsx')

print("Updated files")
