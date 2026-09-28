import { useState, useEffect } from 'react';
import { Edit2, Map, Search, Share2, ExternalLink, FileText, Info, Layers, Copy, Check } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMapEvents, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const createPinIcon = (color: string) => new L.DivIcon({
    html: `<svg width="28" height="42" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.3));">
        <path d="M12 0C5.373 0 0 5.373 0 12c0 8.4 12 24 12 24s12-15.6 12-24c0-6.627-5.373-12-12-12z" fill="${color}" stroke="white" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="4" fill="white" />
    </svg>`,
    className: '',
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -42]
});

const startIcon = createPinIcon('#22c55e');
const endIcon = createPinIcon('#ef4444');

function MapClickHandler({ onMapClick }: { onMapClick: (latlng: L.LatLng) => void }) {
  useMapEvents({ click(e) { onMapClick(e.latlng); } });
  return null;
}

function MapFitter({ bounds }: { bounds: L.LatLngBounds | null }) {
    const map = useMap();
    useEffect(() => {
        if (bounds) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [bounds, map]);
    return null;
}

function MapFlyTo({ location }: { location: L.LatLngExpression | null }) {
    const map = useMap();
    useEffect(() => {
        if (location) {
            map.flyTo(location, 16);
        }
    }, [location, map]);
    return null;
}

import stateBounds from '../stateBounds.json';

export default function MapDisplay({ activeStates = [], isActive = true }: { activeStates?: string[], isActive?: boolean }) {
  const marylandCenter: [number, number] = [39.0458, -76.6413];
  
  const [startPoint, setStartPoint] = useState<L.LatLng | null>(null);
  const [endPoint, setEndPoint] = useState<L.LatLng | null>(null);
  const [startInputText, setStartInputText] = useState<string>('');
  const [endInputText, setEndInputText] = useState<string>('');
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [distance, setDistance] = useState<string>('');
  const [mainRouteInfo, setMainRouteInfo] = useState<{distance: string, duration: string} | null>(null);
  const [rawJson, setRawJson] = useState<any>(null);
  const [rawRequestUrl, setRawRequestUrl] = useState<string>('');
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);
  const [focusRoute, setFocusRoute] = useState<[number, number][] | null>(null);
  const [routeBounds, setRouteBounds] = useState<L.LatLngBounds | null>(null);
  const [profile, setProfile] = useState<'car' | 'foot'>('car');
  const [routeError, setRouteError] = useState<string | null>(null);
  
  // Road Editing State
  const [routeNodes, setRouteNodes] = useState<number[]>([]);
  const [newSpeed, setNewSpeed] = useState<number>(30);
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [activeOverrides, setActiveOverrides] = useState<any[]>([]);
  const [originalSpeed, setOriginalSpeed] = useState<number | null>(null);
  const [isSameRoad, setIsSameRoad] = useState<boolean>(true);
  const [showAlternatives, setShowAlternatives] = useState<boolean>(true);
  const [altRoutes, setAltRoutes] = useState<{coords: [number, number][], distance: string, duration: string}[]>([]);
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [showSteps, setShowSteps] = useState<boolean>(false);
  const [avoidTolls, setAvoidTolls] = useState<boolean>(false);
  const [routePreference, setRoutePreference] = useState<'fastest' | 'shortest'>('fastest');
  const [isBidirectional, setIsBidirectional] = useState<boolean>(true);
  const [backSpeed, setBackSpeed] = useState<number>(30);
  const [isBackClosing, setIsBackClosing] = useState<boolean>(false);
  const [editReason, setEditReason] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState<string>('');
  const [roadName, setRoadName] = useState<string>('');
  const [cityName, setCityName] = useState<string>('');
  const [copiedStart, setCopiedStart] = useState<boolean>(false);
  const [copiedEnd, setCopiedEnd] = useState<boolean>(false);

  useEffect(() => {
    if (startPoint) setStartInputText(`${startPoint.lat.toFixed(5)}, ${startPoint.lng.toFixed(5)}`);
    else setStartInputText('');
  }, [startPoint]);

  useEffect(() => {
    if (endPoint) setEndInputText(`${endPoint.lat.toFixed(5)}, ${endPoint.lng.toFixed(5)}`);
    else setEndInputText('');
  }, [endPoint]);

  useEffect(() => {
    if (activeStates && activeStates.length > 0 && !selectedState) {
        const first = activeStates[0];
        setSelectedState(first);
        const boundsData = (stateBounds as any)[first];
        if (boundsData) {
            setRouteBounds(L.latLngBounds([
                [boundsData[0][0], boundsData[0][1]], 
                [boundsData[1][0], boundsData[1][1]]
            ]));
        }
    }
  }, [activeStates, selectedState]);

  const showToast = (msg: string) => {
      setToastMessage(msg);
      setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchOverrides = async () => {
      try {
          const res = await fetch('http://localhost:8000/overrides', { cache: 'no-store' });
          const data = await res.json();
          setActiveOverrides(data);
      } catch(err) {
          console.error(err);
      }
  };

  const fetchRoute = () => {
    if (startPoint && endPoint) {
      const port = profile === 'car' ? 5002 : 5003;
      const profileName = profile === 'car' ? 'driving' : 'foot';
      const altsParam = (showAlternatives || routePreference === 'shortest') ? '3' : 'false';
      
      let url = `http://localhost:${port}/route/v1/${profileName}/${startPoint.lng},${startPoint.lat};${endPoint.lng},${endPoint.lat}?overview=full&geometries=geojson&annotations=nodes,speed&steps=true&alternatives=${altsParam}`;
      if (avoidTolls && profile === 'car') {
          url += '&exclude=toll';
      }
      setRawRequestUrl(url);
      
      fetch(url)
        .then(res => res.json())
        .then(data => {
          setRawJson(data);
          if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            
            // Check snap distance to see if it's way out of bounds (e.g. >2000m)
            const snapStart = L.latLng(data.waypoints[0].location[1], data.waypoints[0].location[0]);
            const snapEnd = L.latLng(data.waypoints[1].location[1], data.waypoints[1].location[0]);
            
            if (startPoint.distanceTo(snapStart) > 2000 || endPoint.distanceTo(snapEnd) > 2000) {
                setRouteError('Marker dropped outside installed map regions. OSRM cannot route here.');
                setRouteCoordinates([]);
                setAltRoutes([]);
                setDistance('');
                setMainRouteInfo(null);
                setRouteNodes([]);
                setRouteSteps([]);
                return;
            }
            
            setRouteError(null);
            
            let allRoutes = data.routes;
            let primaryIndex = 0;
            
            if (routePreference === 'shortest') {
                let minIdx = 0;
                let minDistance = Infinity;
                allRoutes.forEach((r: any, idx: number) => {
                    if (r.distance < minDistance) {
                        minDistance = r.distance;
                        minIdx = idx;
                    }
                });
                primaryIndex = minIdx;
            }
            
            const primaryRoute = allRoutes[primaryIndex];
            const altRoutesData = allRoutes.filter((_: any, idx: number) => idx !== primaryIndex);
            
            const coords = primaryRoute.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
            setRouteCoordinates(coords);
            
            if (showAlternatives && altRoutesData.length > 0) {
                const alts = altRoutesData.map((r: any) => {
                    const coords = r.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
                    const distMiles = (r.distance / 1609.34).toFixed(2);
                    const durationMins = Math.ceil(r.duration / 60);
                    return { coords, distance: distMiles, duration: durationMins.toString() };
                });
                setAltRoutes(alts);
            } else {
                setAltRoutes([]);
            }
            
            const distMiles = (primaryRoute.distance / 1609.34).toFixed(2);
            const durationMins = Math.ceil(primaryRoute.duration / 60);
            setDistance(`${distMiles} mi, ${durationMins} min`);
            setMainRouteInfo({ distance: distMiles, duration: durationMins.toString() });
            
            // Auto fit bounds
            if (coords.length > 0) {
                setRouteBounds(L.polyline(coords).getBounds());
            }
            
            // Extract the OSM Node IDs and Speeds from the route
            if (primaryRoute.legs[0].annotation) {
                if (primaryRoute.legs[0].annotation.nodes) {
                    setRouteNodes(primaryRoute.legs[0].annotation.nodes);
                }
                if (primaryRoute.legs[0].annotation.speed && primaryRoute.legs[0].annotation.speed.length > 0) {
                    const speedMs = primaryRoute.legs[0].annotation.speed[0];
                    const speedMph = Math.round(speedMs * 2.23694);
                    setOriginalSpeed(speedMph);
                    setNewSpeed(speedMph);
                    setBackSpeed(speedMph);
                }
            }
            
            if (primaryRoute.legs[0].steps) {
                const steps = primaryRoute.legs[0].steps;
                setRouteSteps(steps);
                
                const roadNames = new Set(
                    steps.slice(0, -1)
                         .map((s: any) => s.name || s.ref || '')
                         .filter((name: string) => name && name.toLowerCase() !== 'unnamed')
                );
                setIsSameRoad(roadNames.size <= 1);
                if (roadNames.size > 0) {
                    setRoadName(Array.from(roadNames)[0] as string);
                } else {
                    setRoadName('');
                }
                
                fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${startPoint.lat}&lon=${startPoint.lng}`)
                    .then(res => res.json())
                    .then(geoData => {
                        if (geoData && geoData.address) {
                            const addr = geoData.address;
                            const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
                            setCityName(city);
                        }
                    })
                    .catch(err => console.error("Reverse geocoding error:", err));
            }
          } else {
            setRouteCoordinates([]);
            setAltRoutes([]);
            setDistance('');
            setMainRouteInfo(null);
            setRouteNodes([]);
            setRouteSteps([]);
            setOriginalSpeed(null);
            setIsSameRoad(true);
            setRoadName('');
            setCityName('');
            setRouteError(data.message || 'No route found between these points.');
          }
        })
        .catch(err => {
            console.error("Error fetching route:", err);
            setRouteCoordinates([]);
            setAltRoutes([]);
            setDistance('');
            setMainRouteInfo(null);
            setRouteNodes([]);
            setRouteSteps([]);
            setOriginalSpeed(null);
            setRouteError('Failed to connect to the routing engine.');
        });
    }
  };

  useEffect(() => {
    fetchRoute();
  }, [startPoint, endPoint, profile, showAlternatives, avoidTolls, routePreference]);

  useEffect(() => {
      fetchOverrides();
  }, []);

  useEffect(() => {
      if (isActive) {
          fetchOverrides();
      }
  }, [isActive]);

  const handleMapClick = (latlng: L.LatLng) => {
    setRouteError(null);
    if (!startPoint || (startPoint && endPoint)) {
      setStartPoint(latlng);
      setEndPoint(null);
      setRouteCoordinates([]);
      setAltRoutes([]);
      setDistance('');
      setMainRouteInfo(null);
      setRouteNodes([]);
      setRouteSteps([]);
      setShowSteps(false);
      setFocusRoute(null);
      setRouteBounds(null);
      setOriginalSpeed(null);
      setIsSameRoad(true);
      setRoadName('');
      setIsBidirectional(true);
      setEditReason('');
    } else {
      setEndPoint(latlng);
    }
  };

  const applyRoadEdit = async () => {
    if (routeNodes.length < 2) return;
    
    if (!editReason.trim()) {
        showToast("Please provide a description for this edit.");
        return;
    }
    
    const from_node = routeNodes[0].toString();
    const to_node = routeNodes[1].toString();
    const editLat = routeCoordinates[0][0];
    const editLng = routeCoordinates[0][1];
    
    const edits = [];
    
    if (isBidirectional) {
        edits.push({
            from_node,
            to_node,
            speed_kmh: isClosing ? 0 : Math.round(newSpeed * 1.60934),
            is_closed: isClosing,
            is_bidirectional: true,
            reason: editReason.trim(),
            lat: editLat,
            lng: editLng,
            geometry: JSON.stringify(routeCoordinates),
            road_name: roadName,
            city_name: cityName
        });
    } else {
        // Forward (A -> B)
        edits.push({
            from_node,
            to_node,
            speed_kmh: isClosing ? 0 : Math.round(newSpeed * 1.60934),
            is_closed: isClosing,
            is_bidirectional: false,
            reason: `[Forward] ${editReason.trim()}`,
            lat: editLat,
            lng: editLng,
            geometry: JSON.stringify(routeCoordinates),
            road_name: roadName,
            city_name: cityName
        });
        // Backward (B -> A)
        edits.push({
            from_node: to_node,
            to_node: from_node,
            speed_kmh: isBackClosing ? 0 : Math.round(backSpeed * 1.60934),
            is_closed: isBackClosing,
            is_bidirectional: false,
            reason: `[Backward] ${editReason.trim()}`,
            lat: routeCoordinates[routeCoordinates.length - 1][0],
            lng: routeCoordinates[routeCoordinates.length - 1][1],
            lng: routeCoordinates[routeCoordinates.length - 1][1],
            geometry: JSON.stringify([...routeCoordinates].reverse()),
            road_name: roadName,
            city_name: cityName
        });
    }

    try {
        for (const payload of edits) {
            await fetch('http://localhost:8000/overrides', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        showToast("Edit applied! Rebuilding routing graph...");
        setEditReason('');
        
        fetchOverrides();
        window.dispatchEvent(new Event('edit-applied'));
        setTimeout(fetchRoute, 3000);
        
    } catch (err) {
        console.error(err);
        showToast("Failed to save road edit.");
    }
  };

  const revertOverride = async (id: number) => {
      try {
          const res = await fetch(`http://localhost:8000/overrides/${id}`, { method: 'DELETE' });
          const result = await res.json();
          showToast(result.message);
          fetchOverrides();
          setFocusRoute(null);
          setTimeout(fetchRoute, 3000);
      } catch(err) {
          console.error(err);
          showToast("Failed to revert override.");
      }
  };

  const handleGoTo = (ov: any) => {
      if (ov.geometry) {
          try {
              const coords = JSON.parse(ov.geometry);
              setFocusRoute(coords);
              setRouteBounds(L.polyline(coords).getBounds());
          } catch(e) {}
      } else if (ov.lat && ov.lng) {
          // Fallback if no geometry
          setRouteBounds(L.latLngBounds([ov.lat, ov.lng], [ov.lat, ov.lng]));
      }
  };

  useEffect(() => {
    const handleMapGoTo = (e: any) => handleGoTo(e.detail);
    window.addEventListener('map-goto', handleMapGoTo);
    return () => window.removeEventListener('map-goto', handleMapGoTo);
  }, []);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      {toastMessage && (
          <div className="animate-fade-in" style={{
              position: 'fixed',
              top: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(30, 41, 59, 0.95)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255,255,255,0.1)',
              padding: '12px 24px',
              borderRadius: 0,
              color: 'white',
              fontWeight: 500,
              zIndex: 9999,
              boxShadow: '0 4px 30px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
          }}>
              <span style={{ fontSize: '18px' }}>ℹ️</span> {toastMessage}
          </div>
      )}
      
      {routeError && (
          <div className="animate-fade-in" style={{
              position: 'absolute',
              top: '80px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 2000,
              background: 'rgba(239, 68, 68, 0.95)',
              color: 'white',
              padding: '12px 24px',
              borderRadius: 0,
              boxShadow: '0 10px 25px rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '15px',
              fontWeight: 500,
              backdropFilter: 'blur(4px)',
              border: '1px solid #fca5a5'
          }}>
              <span style={{ fontSize: '20px' }}>⚠️</span> {routeError}
          </div>
      )}
      <MapContainer 
        center={marylandCenter} zoom={13} 
        style={{ height: '100%', width: '100%', background: 'var(--bg-color)' }}
        zoomControl={false}
      >
        <LayersControl position="bottomleft">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite">
            <TileLayer
              attribution='&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <MapClickHandler onMapClick={handleMapClick} />
        <MapFitter bounds={routeBounds} />
        
        {startPoint && <Marker position={startPoint} icon={startIcon}><Popup>Start</Popup></Marker>}
        {endPoint && <Marker position={endPoint} icon={endIcon}><Popup>End</Popup></Marker>}
        {/* Alternative Routes - Outlines */}
        {altRoutes.map((alt, i) => (
            <Polyline key={`alt-out-${i}`} positions={alt.coords} color="#6A7B94" weight={10} opacity={0.8} />
        ))}
        {/* Alternative Routes - Inner Fills */}
        {altRoutes.map((alt, i) => (
            <Polyline key={`alt-in-${i}`} positions={alt.coords} color="#8AB4F8" weight={6} opacity={1.0}>
                <Tooltip permanent direction="center" className="alt-route-tooltip">
                    <div>{alt.duration} min</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{alt.distance} mi</div>
                </Tooltip>
            </Polyline>
        ))}

        {/* Main Route - Outline */}
        {routeCoordinates.length > 0 && <Polyline positions={routeCoordinates} color="#1036A3" weight={10} opacity={0.9} />}
        {/* Main Route - Inner Fill */}
        {routeCoordinates.length > 0 && (
            <Polyline positions={routeCoordinates} color="#1A73E8" weight={6} opacity={1.0}>
                {mainRouteInfo && (
                    <Tooltip permanent direction="center" className="main-route-tooltip">
                        <div>{mainRouteInfo.duration} min</div>
                        <div style={{ fontSize: '10px', opacity: 0.8 }}>{mainRouteInfo.distance} mi</div>
                    </Tooltip>
                )}
            </Polyline>
        )}
        
        {/* Draw all active overrides on the map! */}
        {activeOverrides.map(ov => {
            if (ov.geometry) {
                try {
                    const coords = JSON.parse(ov.geometry);
                    const color = ov.is_closed ? '#ef4444' : '#f59e0b'; // Red for closed, Orange for speed change
                    return <Polyline key={ov.id} positions={coords} color={color} weight={8} opacity={0.9} dashArray="10, 10" />;
                } catch(e) {
                    return null;
                }
            }
            return null;
        })}
      </MapContainer>
      
      {/* Modern Routing Input Panel */}
      <div className="glass-panel animate-fade-in" style={{
        position: 'absolute',
        top: '20px', left: '20px',
        zIndex: 1000,
        width: '340px',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        gap: '12px'
      }}>
        {/* Active States Dropdown */}
        {activeStates.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--input-bg)', borderRadius: 0, border: '1px solid var(--input-border)', padding: '6px 12px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginRight: '8px' }}>Jump to Map:</span>
                <select 
                    style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', fontSize: '13px', cursor: 'pointer' }}
                    value={selectedState}
                    onChange={(e) => {
                        const state = e.target.value;
                        setSelectedState(state);
                        if (state) {
                            const boundsData = (stateBounds as any)[state];
                            if (boundsData) {
                                setRouteBounds(L.latLngBounds([
                                    [boundsData[0][0], boundsData[0][1]], 
                                    [boundsData[1][0], boundsData[1][1]]
                                ]));
                            }
                        }
                    }}
                >
                    {activeStates.map(st => (
                        <option key={st} value={st} style={{ color: '#000' }}>
                            {st.charAt(0).toUpperCase() + st.slice(1).replace('-', ' ')}
                        </option>
                    ))}
                </select>
                <button
                    onClick={() => {
                        if (selectedState) {
                            const boundsData = (stateBounds as any)[selectedState];
                            if (boundsData) {
                                setRouteBounds(L.latLngBounds([
                                    [boundsData[0][0], boundsData[0][1]], 
                                    [boundsData[1][0], boundsData[1][1]]
                                ]));
                            }
                        }
                    }}
                    style={{ background: 'transparent', border: '1px solid var(--input-border)', color: 'var(--text-primary)', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '8px', fontSize: '11px', fontWeight: 600 }}
                    title={`Jump to ${selectedState}`}
                >
                    <Map size={14} style={{ marginRight: '4px' }} /> Go
                </button>
            </div>
        )}
        
        {/* Start Input */}
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--input-bg)', borderRadius: 0, border: '1px solid var(--input-border)', padding: '4px 12px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e', marginRight: '8px' }}></div>
            <input 
                type="text" 
                placeholder="Start - click map or type lat, lng" 
                value={startInputText}
                onChange={(e) => setStartInputText(e.target.value)}
                onBlur={() => {
                    const parts = startInputText.split(',').map(p => parseFloat(p.trim()));
                    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                        setStartPoint(L.latLng(parts[0], parts[1]));
                        if (startPoint && endPoint) setEndPoint(null); // Optional: clear end if we're resetting start
                    } else if (!startInputText.trim()) {
                        setStartPoint(null);
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                }}
                style={{ flex: 1, background: 'transparent', border: 'none', padding: '8px 0', color: 'var(--text-primary)', outline: 'none', fontSize: '13px' }}
            />
            {startPoint && (
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button 
                        onClick={() => {
                            navigator.clipboard.writeText(startInputText);
                            setCopiedStart(true);
                            setTimeout(() => setCopiedStart(false), 2000);
                        }} 
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        title="Copy coordinates"
                    >
                        {copiedStart ? <Check size={14} color="#22c55e" /> : <Copy size={14} />}
                    </button>
                    <button onClick={() => { setStartPoint(null); setRouteCoordinates([]); setAltRoutes([]); setDistance(''); setRouteSteps([]); setShowSteps(false); setRouteError(null); }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '4px', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                </div>
            )}
        </div>
        
        {/* End Input */}
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--input-bg)', borderRadius: 0, border: '1px solid var(--input-border)', padding: '4px 12px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px #ef4444', marginRight: '8px' }}></div>
            <input 
                type="text" 
                placeholder="End - click map or type lat, lng" 
                value={endInputText}
                onChange={(e) => setEndInputText(e.target.value)}
                onBlur={() => {
                    const parts = endInputText.split(',').map(p => parseFloat(p.trim()));
                    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                        setEndPoint(L.latLng(parts[0], parts[1]));
                    } else if (!endInputText.trim()) {
                        setEndPoint(null);
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                }}
                style={{ flex: 1, background: 'transparent', border: 'none', padding: '8px 0', color: 'var(--text-primary)', outline: 'none', fontSize: '13px' }}
            />
            {endPoint && (
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button 
                        onClick={() => {
                            navigator.clipboard.writeText(endInputText);
                            setCopiedEnd(true);
                            setTimeout(() => setCopiedEnd(false), 2000);
                        }} 
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        title="Copy coordinates"
                    >
                        {copiedEnd ? <Check size={14} color="#22c55e" /> : <Copy size={14} />}
                    </button>
                    <button onClick={() => { setEndPoint(null); setRouteCoordinates([]); setAltRoutes([]); setDistance(''); setRouteSteps([]); setShowSteps(false); setRouteError(null); }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '4px', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                </div>
            )}
        </div>

        {/* Controls Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            {/* Profile Toggle */}
            <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 0, padding: '4px', border: '1px solid var(--input-border)' }}>
                <button 
                    onClick={() => setProfile('car')}
                    style={{ padding: '6px 14px', borderRadius: 0, border: 'none', background: profile === 'car' ? '#3b82f6' : 'transparent', color: profile === 'car' ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: profile === 'car' ? 600 : 500, transition: 'all 0.2s', boxShadow: profile === 'car' ? '0 2px 10px rgba(59,130,246,0.3)' : 'none' }}
                >Car</button>
                <button 
                    onClick={() => setProfile('foot')}
                    style={{ padding: '6px 14px', borderRadius: 0, border: 'none', background: profile === 'foot' ? '#10b981' : 'transparent', color: profile === 'foot' ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: profile === 'foot' ? 600 : 500, transition: 'all 0.2s', boxShadow: profile === 'foot' ? '0 2px 10px rgba(16,185,129,0.3)' : 'none' }}
                >Foot</button>
            </div>

            {/* Preference Toggle */}
            <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 0, padding: '4px', border: '1px solid var(--input-border)' }}>
                <button 
                    onClick={() => setRoutePreference('fastest')}
                    style={{ padding: '6px 14px', borderRadius: 0, border: 'none', background: routePreference === 'fastest' ? '#3b82f6' : 'transparent', color: routePreference === 'fastest' ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: routePreference === 'fastest' ? 600 : 500, transition: 'all 0.2s', boxShadow: routePreference === 'fastest' ? '0 2px 10px rgba(59,130,246,0.3)' : 'none' }}
                >Fastest</button>
                <button 
                    onClick={() => setRoutePreference('shortest')}
                    style={{ padding: '6px 14px', borderRadius: 0, border: 'none', background: routePreference === 'shortest' ? '#10b981' : 'transparent', color: routePreference === 'shortest' ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: routePreference === 'shortest' ? 600 : 500, transition: 'all 0.2s', boxShadow: routePreference === 'shortest' ? '0 2px 10px rgba(16,185,129,0.3)' : 'none' }}
                >Shortest</button>
            </div>

            {/* Options Toggle */}
            <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 0, padding: '4px', border: '1px solid var(--input-border)' }}>
                 {profile === 'car' && (
                    <button 
                        onClick={() => setAvoidTolls(!avoidTolls)}
                        style={{ padding: '6px 10px', borderRadius: 0, border: 'none', background: avoidTolls ? 'var(--divider-bg)' : 'transparent', color: avoidTolls ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s' }}
                    >No Tolls</button>
                )}
                <button 
                    onClick={() => setShowAlternatives(!showAlternatives)}
                    style={{ padding: '6px 10px', borderRadius: 0, border: 'none', background: showAlternatives ? 'var(--divider-bg)' : 'transparent', color: showAlternatives ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s' }}
                >Alts</button>
            </div>

            <div style={{ display: 'flex', gap: '4px' }}>
                <button 
                    onClick={() => {
                        const temp = startPoint;
                        setStartPoint(endPoint);
                        setEndPoint(temp);
                    }} 
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                    title="Swap Start and End"
                    onMouseOver={(e) => e.currentTarget.style.background = 'var(--divider-bg)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'var(--input-bg)'}
                >
                    ⇅
                </button>

                <button 
                    onClick={() => {
                        setStartPoint(null);
                        setEndPoint(null);
                        setRouteCoordinates([]);
                        setAltRoutes([]);
                        setDistance('');
                        setMainRouteInfo(null);
                        setRouteNodes([]);
                        setRouteSteps([]);
                        setShowSteps(false);
                        setFocusRoute(null);
                        setRouteError(null);
                        setOriginalSpeed(null);
                        setIsSameRoad(true);
                        setRoadName('');
                        setIsBidirectional(true);
                    }} 
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: '#ef4444', padding: '6px 12px', borderRadius: 0, cursor: 'pointer', fontSize: '12px', fontWeight: 600, transition: 'all 0.2s' }}
                    title="Clear Route"
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'var(--input-bg)'}
                >
                    Clear
                </button>
            </div>
        </div>
        
        {/* Route Summary */}
        {!routeError && distance && (
            <div style={{ background: 'var(--panel-inner-bg)', padding: '12px', borderRadius: 0, border: '1px solid var(--input-border)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>{distance}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                            onClick={() => setShowRawJson(true)} 
                            style={{ background: 'var(--divider-bg)', border: 'none', color: 'var(--text-primary)', padding: '4px 10px', borderRadius: 0, fontSize: '11px', cursor: 'pointer', fontWeight: 500, transition: 'background 0.2s' }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'var(--panel-border)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'var(--divider-bg)'}
                        >
                            JSON
                        </button>
                        <button 
                            onClick={() => setShowSteps(!showSteps)} 
                            style={{ background: 'var(--divider-bg)', border: 'none', color: 'var(--text-primary)', padding: '4px 10px', borderRadius: 0, fontSize: '11px', cursor: 'pointer', fontWeight: 500, transition: 'background 0.2s' }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'var(--panel-border)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'var(--divider-bg)'}
                        >
                            {showSteps ? 'Hide Navigation' : 'Turn-by-turn'}
                        </button>
                    </div>
                </div>
                
                {showSteps && routeSteps.length > 0 && (
                    <div className="custom-scrollbar" style={{ marginTop: '12px', maxHeight: '250px', overflowY: 'auto', borderTop: '1px solid var(--input-border)', paddingTop: '8px', paddingRight: '4px' }}>
                        {routeSteps.map((step, idx) => {
                            if (step.maneuver.type === 'arrive') {
                                return <div key={idx} style={{ padding: '8px 0', fontSize: '13px', color: '#10b981', fontWeight: 600 }}>🏁 Arrive at destination</div>;
                            }
                            
                            const distStr = step.distance < 160.9 ? `${Math.round(step.distance * 3.28084)} ft` : `${(step.distance / 1609.34).toFixed(2)} mi`;
                            
                            return (
                                <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid var(--input-border)', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <span style={{ flex: 1, paddingRight: '12px', lineHeight: '1.4' }}>
                                        <strong style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                                            {step.maneuver.type.replace('-', ' ')} {step.maneuver.modifier ? step.maneuver.modifier.replace('-', ' ') : ''}
                                        </strong>
                                        {step.name ? ` onto ${step.name}` : ''}
                                    </span>
                                    {step.distance > 0 && <span style={{ color: '#64748b', whiteSpace: 'nowrap', paddingTop: '1px' }}>{distStr}</span>}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        )}
      </div>



      {/* Editor Panel */}
      {routeCoordinates.length > 0 && profile === 'car' && isSameRoad && (
          <div className="glass-panel animate-fade-in" style={{
              position: 'absolute', bottom: '30px', right: '20px',
              zIndex: 1000, padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px',
              alignItems: 'stretch',
              width: '320px', maxWidth: 'calc(100vw - 40px)'
          }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }}></div>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '13px', letterSpacing: '0.5px' }}>ROAD EDITOR</span>
              </div>
              
              <div style={{ height: '1px', width: '100%', background: 'var(--divider-bg)' }}></div>

              <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 0, padding: '4px', border: '1px solid var(--input-border)' }}>
                  <button 
                      onClick={() => setIsBidirectional(true)}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 0, border: 'none', background: isBidirectional ? '#6366f1' : 'transparent', color: isBidirectional ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: isBidirectional ? 600 : 500, transition: 'all 0.2s', boxShadow: isBidirectional ? '0 2px 10px rgba(99,102,241,0.3)' : 'none' }}
                  >Same Both Ways</button>
                  <button 
                      onClick={() => setIsBidirectional(false)}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 0, border: 'none', background: !isBidirectional ? '#6366f1' : 'transparent', color: !isBidirectional ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: !isBidirectional ? 600 : 500, transition: 'all 0.2s', boxShadow: !isBidirectional ? '0 2px 10px rgba(99,102,241,0.3)' : 'none' }}
                  >Independent</button>
              </div>

              {/* Forward Direction */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px', background: 'var(--panel-inner-bg)', borderRadius: 0, border: '1px solid var(--input-border)' }}>
                  {!isBidirectional && <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>Direction: A &rarr; B</span>}
                  
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Speed Limit</span>
                      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--input-bg)', borderRadius: 0, padding: '6px 12px', opacity: isClosing ? 0.5 : 1, border: '1px solid var(--input-border)' }}>
                          <input type="number" value={newSpeed} onChange={(e) => setNewSpeed(Number(e.target.value))} disabled={isClosing} style={{ width: '40px', background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600, outline: 'none', textAlign: 'center' }} />
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '4px', fontWeight: 500 }}>mph</span>
                      </div>
                  </div>
                  
                  <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 0, padding: '4px', border: '1px solid var(--input-border)' }}>
                      <button onClick={() => setIsClosing(false)} style={{ flex: 1, padding: '8px 0', borderRadius: 0, border: 'none', background: !isClosing ? '#3b82f6' : 'transparent', color: !isClosing ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: !isClosing ? 600 : 500 }}>Open</button>
                      <button onClick={() => setIsClosing(true)} style={{ flex: 1, padding: '8px 0', borderRadius: 0, border: 'none', background: isClosing ? '#ef4444' : 'transparent', color: isClosing ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: isClosing ? 600 : 500 }}>Closed</button>
                  </div>
              </div>

              {/* Backward Direction */}
              {!isBidirectional && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px', background: 'var(--panel-inner-bg)', borderRadius: 0, border: '1px solid var(--input-border)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>Direction: B &rarr; A</span>
                  
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px' }}>Speed Limit</span>
                      <div style={{ display: 'flex', alignItems: 'center', background: 'var(--input-bg)', borderRadius: 0, padding: '6px 12px', opacity: isBackClosing ? 0.5 : 1, border: '1px solid var(--input-border)' }}>
                          <input type="number" value={backSpeed} onChange={(e) => setBackSpeed(Number(e.target.value))} disabled={isBackClosing} style={{ width: '40px', background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600, outline: 'none', textAlign: 'center' }} />
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '4px', fontWeight: 500 }}>mph</span>
                      </div>
                  </div>
                  
                  <div style={{ display: 'flex', background: 'var(--input-bg)', borderRadius: 0, padding: '4px', border: '1px solid var(--input-border)' }}>
                      <button onClick={() => setIsBackClosing(false)} style={{ flex: 1, padding: '8px 0', borderRadius: 0, border: 'none', background: !isBackClosing ? '#3b82f6' : 'transparent', color: !isBackClosing ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: !isBackClosing ? 600 : 500 }}>Open</button>
                      <button onClick={() => setIsBackClosing(true)} style={{ flex: 1, padding: '8px 0', borderRadius: 0, border: 'none', background: isBackClosing ? '#ef4444' : 'transparent', color: isBackClosing ? 'white' : 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: isBackClosing ? 600 : 500 }}>Closed</button>
                  </div>
              </div>
              )}

              {/* City Name Input */}
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--input-bg)', borderRadius: 0, padding: '8px 12px', border: '1px solid var(--input-border)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginRight: '8px', minWidth: '80px' }}>City Name:</span>
                  <input 
                      type="text" 
                      placeholder="e.g. Dover"
                      value={cityName}
                      onChange={(e) => setCityName(e.target.value)}
                      style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', minWidth: 0 }}
                  />
              </div>

              {/* Road Name Input */}
              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--input-bg)', borderRadius: 0, padding: '8px 12px', border: '1px solid var(--input-border)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginRight: '8px', minWidth: '80px' }}>Street Name:</span>
                  <input 
                      type="text" 
                      placeholder="e.g. Main Street"
                      value={roadName}
                      onChange={(e) => setRoadName(e.target.value)}
                      style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', minWidth: 0 }}
                  />
              </div>

              {/* Description Input */}
              <div style={{ display: 'flex', alignItems: 'flex-start', background: 'var(--input-bg)', borderRadius: 0, padding: '10px 12px', border: '1px solid var(--input-border)' }}>
                  <textarea 
                      placeholder="Reason for edit..."
                      value={editReason} 
                      onChange={(e) => setEditReason(e.target.value)}
                      style={{ width: '100%', background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '13px', outline: 'none', resize: 'vertical', minHeight: '60px' }}
                  />
              </div>

              {/* Apply Button */}
              <button 
                  onClick={applyRoadEdit} 
                  style={{ 
                      width: '100%',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                      color: 'white', border: 'none', padding: '12px', borderRadius: 0, 
                      fontSize: '13px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                      boxShadow: '0 4px 15px rgba(16,185,129,0.4)',
                      textTransform: 'uppercase', letterSpacing: '0.5px'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              >
                  Apply Edit
              </button>
          </div>
      )}

      {/* Raw JSON Modal */}
      {showRawJson && rawJson && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.5)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(5px)'
        }}>
          <div className="glass-panel custom-scrollbar" style={{ width: '80%', height: '80%', overflow: 'auto', padding: '24px', position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <button 
              onClick={() => setShowRawJson(false)}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'var(--danger)', border: 'none', color: 'white', padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
            >Close</button>
            <h3 style={{ marginTop: 0, marginBottom: '16px', color: 'var(--text-primary)' }}>OSRM Request & Response</h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>Request URL:</div>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(rawRequestUrl);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 2000);
                }}
                style={{ background: 'transparent', border: '1px solid var(--input-border)', color: 'var(--text-primary)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', transition: 'all 0.2s' }}
                onMouseOver={(e) => e.currentTarget.style.background = 'var(--divider-bg)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {copiedUrl ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                {copiedUrl ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-primary)', background: 'var(--input-bg)', padding: '12px', border: '1px solid var(--input-border)', marginBottom: '20px', wordBreak: 'break-all', borderRadius: '4px' }}>
                {rawRequestUrl}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>Response JSON:</div>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(rawJson));
                  setCopiedJson(true);
                  setTimeout(() => setCopiedJson(false), 2000);
                }}
                style={{ background: 'transparent', border: '1px solid var(--input-border)', color: 'var(--text-primary)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', transition: 'all 0.2s' }}
                onMouseOver={(e) => e.currentTarget.style.background = 'var(--divider-bg)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {copiedJson ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                {copiedJson ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre style={{ flex: 1, fontSize: '12px', color: 'var(--text-primary)', background: 'var(--input-bg)', padding: '16px', border: '1px solid var(--input-border)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', borderRadius: '4px' }}>
              {JSON.stringify(rawJson)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
