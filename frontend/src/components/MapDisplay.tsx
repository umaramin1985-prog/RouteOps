import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Navigation,
  Car,
  Footprints,
  ArrowUpDown,
  ArrowLeft,
  X,
  MapPin,
  Copy,
  Check,
  RotateCcw,
  CornerUpLeft,
  CornerUpRight,
  ArrowUp,
  LocateFixed,
  Plus,
  Minus,
  Wrench,
  Sliders,
  ChevronDown,
  ChevronUp,
  Trash2
} from 'lucide-react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Tooltip,
  useMapEvents,
  useMap,
  GeoJSON
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import stateBounds from '../stateBounds.json';
import usStatesGeoJson from '../us-states.json';
import { searchPlaces, reverseGeocode } from '../utils/geocoding';
import type { PlaceResult } from '../utils/geocoding';

// Fix Leaflet marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// ==========================================================================
// Google Maps Authentic Marker Icons
// ==========================================================================

const gmapsStartIcon = new L.DivIcon({
  html: `
    <div style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: #ffffff; border: 4px solid #188038; box-shadow: 0 2px 6px rgba(0,0,0,0.4); cursor: grab;">
      <div style="width: 6px; height: 6px; border-radius: 50%; background: #188038;"></div>
    </div>
  `,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

const gmapsEndIcon = new L.DivIcon({
  html: `
    <svg width="28" height="40" viewBox="0 0 28 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 3px 4px rgba(0,0,0,0.4)); cursor: grab;">
      <path d="M14 0C6.268 0 0 6.268 0 14C0 24.5 14 40 14 40S28 24.5 28 14C28 6.268 21.732 0 14 0Z" fill="#EA4335"/>
      <circle cx="14" cy="14" r="5.5" fill="#B31412"/>
    </svg>
  `,
  className: '',
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  popupAnchor: [0, -40]
});

const createGmapsStopIcon = (label: string | number) => new L.DivIcon({
  html: `
    <div style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: #ffffff; border: 3px solid #1a73e8; box-shadow: 0 2px 6px rgba(0,0,0,0.4); cursor: grab; font-family: Inter, sans-serif; font-size: 11px; font-weight: 700; color: #1a73e8;">
      ${label}
    </div>
  `,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

const gmapsPlaceIcon = new L.DivIcon({
  html: `
    <svg width="26" height="38" viewBox="0 0 28 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0px 3px 4px rgba(0,0,0,0.4)); cursor: pointer;">
      <path d="M14 0C6.268 0 0 6.268 0 14C0 24.5 14 40 14 40S28 24.5 28 14C28 6.268 21.732 0 14 0Z" fill="#EA4335"/>
      <circle cx="14" cy="14" r="5" fill="#FFFFFF"/>
    </svg>
  `,
  className: '',
  iconSize: [26, 38],
  iconAnchor: [13, 38],
  popupAnchor: [0, -38]
});

const gmapsGpsIcon = new L.DivIcon({
  html: `
    <div class="gmaps-gps-pulse">
      <div class="gmaps-gps-dot"></div>
    </div>
  `,
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

// ==========================================================================
// Map Interaction Bridge
// ==========================================================================

function MapControllerBridge({
  onMapReady,
  onMapClick,
  onContextMenu
}: {
  onMapReady: (map: L.Map) => void;
  onMapClick: (latlng: L.LatLng) => void;
  onContextMenu: (e: L.LeafletMouseEvent) => void;
}) {
  const map = useMap();
  useEffect(() => {
    onMapReady(map);
  }, [map, onMapReady]);

  useMapEvents({
    click(e) {
      onMapClick(e.latlng);
    },
    contextmenu(e) {
      e.originalEvent.preventDefault();
      onContextMenu(e);
    }
  });

  return null;
}

function MapFitter({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [60, 60] });
    }
  }, [bounds, map]);
  return null;
}

// ==========================================================================
// Main MapDisplay Component
// ==========================================================================

interface IntermediateStop {
  id: string;
  point: L.LatLng | null;
  text: string;
}

interface MapDisplayProps {
  activeStates?: string[];
  isActive?: boolean;
  dockerStatus?: any;
}

export default function MapDisplay({
  activeStates = [],
  isActive = true,
  dockerStatus = null
}: MapDisplayProps) {
  const role = localStorage.getItem('role') || 'admin';
  const defaultCenter: [number, number] = [39.0458, -76.6413]; // Maryland

  const mapInstanceRef = useRef<L.Map | null>(null);

  // Layout mode: 'search' or 'directions'
  const [panelMode, setPanelMode] = useState<'search' | 'directions'>('search');

  // Map Layer: 'osm' (Default) or 'satellite'
  const [mapLayer, setMapLayer] = useState<'osm' | 'satellite'>('osm');

  // Search input state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Active Place Card (from search or "What's here?")
  const [activePlace, setActivePlace] = useState<{
    title: string;
    subtitle: string;
    lat: number;
    lng: number;
  } | null>(null);

  // Origin & Destination state
  const [startPoint, setStartPoint] = useState<L.LatLng | null>(null);
  const [endPoint, setEndPoint] = useState<L.LatLng | null>(null);
  const [startInputText, setStartInputText] = useState('');
  const [endInputText, setEndInputText] = useState('');

  // Multi-stop Routing: Intermediate Destinations
  const [stops, setStops] = useState<IntermediateStop[]>([]);

  // Autocomplete Suggestions
  const [startSuggestions, setStartSuggestions] = useState<PlaceResult[]>([]);
  const [endSuggestions, setEndSuggestions] = useState<PlaceResult[]>([]);
  const [stopSuggestions, setStopSuggestions] = useState<PlaceResult[]>([]);
  const [activeInputFocus, setActiveInputFocus] = useState<string | null>(null);

  // Travel Mode: 'car' | 'foot'
  const [profile, setProfile] = useState<'car' | 'foot'>('car');
  const [routePreference, setRoutePreference] = useState<'fastest' | 'shortest'>('fastest');
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(true);
  const [showOptionsBar, setShowOptionsBar] = useState(false);

  // Routing results
  const [allRoutes, setAllRoutes] = useState<any[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [altRoutes, setAltRoutes] = useState<{ coords: [number, number][]; distance: string; duration: string; via: string; index: number }[]>([]);
  const [mainRouteInfo, setMainRouteInfo] = useState<{ distance: string; duration: string; via: string } | null>(null);
  const [routeSteps, setRouteSteps] = useState<any[]>([]);
  const [showSteps, setShowSteps] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeBounds, setRouteBounds] = useState<L.LatLngBounds | null>(null);

  // User GPS Location
  const [userLocation, setUserLocation] = useState<L.LatLng | null>(null);

  // Right-click Context Menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    latlng: L.LatLng;
  } | null>(null);

  // Road Editor & GeoOps tools
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [selectedState, setSelectedState] = useState('');
  const [activeEngine, setActiveEngine] = useState<'osrm' | 'nominatim' | 'pelias'>('osrm');
  const [activeOverrides, setActiveOverrides] = useState<any[]>([]);
  const [routeNodes, setRouteNodes] = useState<number[]>([]);
  const [isSameRoad, setIsSameRoad] = useState(true);
  const [roadName, setRoadName] = useState('');
  const [cityName, setCityName] = useState('');
  const [newSpeed, setNewSpeed] = useState(30);
  const [isClosing, setIsClosing] = useState(false);
  const [isBidirectional, setIsBidirectional] = useState(true);
  const [backSpeed, setBackSpeed] = useState(30);
  const [isBackClosing, setIsBackClosing] = useState(false);
  const [editReason, setEditReason] = useState('');

  // Raw JSON Debug Modal
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawJson, setRawJson] = useState<any>(null);
  const [rawRequestUrl, setRawRequestUrl] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // Toasts
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  /**
   * Complete reset: Clears all push pins (start, end, stops, dropped place, GPS), inputs, and routes.
   */
  const clearAllPinsAndRoute = () => {
    setStartPoint(null);
    setEndPoint(null);
    setStops([]);
    setActivePlace(null);
    setUserLocation(null);
    setStartInputText('');
    setEndInputText('');
    setSearchQuery('');
    setSearchResults([]);
    setStartSuggestions([]);
    setEndSuggestions([]);
    setStopSuggestions([]);
    setRouteCoordinates([]);
    setAltRoutes([]);
    setMainRouteInfo(null);
    setRouteSteps([]);
    setShowSteps(false);
    setRouteError(null);
    setRouteNodes([]);
    setRouteBounds(null);
    setIsSameRoad(true);
    setRoadName('');
    showToast('Cleared all points and routes.');
  };

  // Add intermediate destination stop
  const addDestinationStop = () => {
    if (stops.length >= 8) {
      showToast('Maximum of 8 stops allowed.');
      return;
    }
    const newId = `stop-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    setStops((prev) => [...prev, { id: newId, point: null, text: '' }]);
  };

  const removeDestinationStop = (id: string) => {
    setStops((prev) => prev.filter((s) => s.id !== id));
  };

  const updateStopText = (id: string, text: string) => {
    setStops((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));
  };

  const updateStopPoint = async (id: string, point: L.LatLng, text?: string) => {
    const defaultText = text || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
    setStops((prev) => prev.map((s) => (s.id === id ? { ...s, point, text: defaultText } : s)));
    if (!text) {
      const geo = await reverseGeocode(point.lat, point.lng, dockerStatus, activeEngine);
      if (geo.formattedAddress) {
        setStops((prev) => prev.map((s) => (s.id === id ? { ...s, text: geo.formattedAddress } : s)));
      }
    }
  };

  // Determine active profile states
  const currentProfileStates = Array.isArray(dockerStatus?.active_states)
    ? dockerStatus.active_states
    : (dockerStatus?.active_states && typeof dockerStatus.active_states === 'object'
      ? (dockerStatus.active_states[profile] || []).filter((s: string) => s !== 'all')
      : activeStates);

  useEffect(() => {
    if (currentProfileStates && currentProfileStates.length > 0) {
      if (!selectedState || !currentProfileStates.includes(selectedState)) {
        const first = currentProfileStates[0];
        setSelectedState(first);
        const boundsData = (stateBounds as any)[first];
        if (boundsData) {
          setRouteBounds(L.latLngBounds([
            [boundsData[0][0], boundsData[0][1]],
            [boundsData[1][0], boundsData[1][1]]
          ]));
        }
      }
    }
  }, [currentProfileStates.join(','), selectedState]);

  // Fetch overrides on load
  const fetchOverrides = async () => {
    try {
      const res = await fetch(`/api/overrides`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setActiveOverrides(data);
      }
    } catch (err) {
      console.error('Failed to fetch overrides:', err);
    }
  };

  useEffect(() => {
    fetchOverrides();
  }, []);

  useEffect(() => {
    if (isActive) fetchOverrides();
  }, [isActive]);

  // Active Geocoding Engine computation (strictly local Pelias or Nominatim)
  const activeGeocoderName = (activeEngine === 'nominatim' || (activeEngine === 'osrm' && dockerStatus?.nominatim === 'running' && dockerStatus?.pelias !== 'running'))
    ? 'Nominatim'
    : (activeEngine === 'pelias' || dockerStatus?.pelias === 'running')
    ? 'Pelias'
    : (dockerStatus?.nominatim === 'running')
    ? 'Nominatim'
    : 'Local Geocoder';

  const isGeocoderOnline = (activeGeocoderName === 'Pelias' && (dockerStatus?.pelias === 'running' || dockerStatus?.pelias_port)) ||
    (activeGeocoderName === 'Nominatim' && (dockerStatus?.nominatim === 'running' || dockerStatus?.nominatim_port));

  // ==========================================================================
  // Autocomplete Searches with Debounce
  // ==========================================================================

  // Main search bar autocomplete
  useEffect(() => {
    if (!searchQuery.trim() || panelMode !== 'search') {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      const results = await searchPlaces(searchQuery, { dockerStatus, activeEngine });
      setSearchResults(results);
      setIsSearching(false);
    }, 280);
    return () => clearTimeout(timer);
  }, [searchQuery, panelMode, activeEngine, dockerStatus]);

  // Start input autocomplete
  useEffect(() => {
    if (!startInputText.trim() || activeInputFocus !== 'start') {
      setStartSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchPlaces(startInputText, { dockerStatus, activeEngine });
      setStartSuggestions(results);
    }, 280);
    return () => clearTimeout(timer);
  }, [startInputText, activeInputFocus, activeEngine, dockerStatus]);

  // End input autocomplete
  useEffect(() => {
    if (!endInputText.trim() || activeInputFocus !== 'end') {
      setEndSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchPlaces(endInputText, { dockerStatus, activeEngine });
      setEndSuggestions(results);
    }, 280);
    return () => clearTimeout(timer);
  }, [endInputText, activeInputFocus, activeEngine, dockerStatus]);

  // Intermediate stop autocomplete
  const activeFocusedStop = useMemo(
    () => stops.find((s) => s.id === activeInputFocus),
    [stops, activeInputFocus]
  );

  useEffect(() => {
    if (!activeFocusedStop || !activeFocusedStop.text.trim()) {
      setStopSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchPlaces(activeFocusedStop.text, { dockerStatus, activeEngine });
      setStopSuggestions(results);
    }, 280);
    return () => clearTimeout(timer);
  }, [activeFocusedStop?.text, activeEngine, dockerStatus]);

  // ==========================================================================
  // OSRM Multi-Stop Route Calculation
  // ==========================================================================

  const fetchRoute = () => {
    const validPoints: L.LatLng[] = [];
    if (startPoint) validPoints.push(startPoint);
    for (const s of stops) {
      if (s.point) validPoints.push(s.point);
    }
    if (endPoint) validPoints.push(endPoint);

    if (validPoints.length < 2) return;

    const port = profile === 'car' ? (dockerStatus?.car_port || 5001) : (dockerStatus?.foot_port || 5005);
    const profileName = profile === 'car' ? 'driving' : 'foot';
    // OSRM only generates alternative routes for 2-waypoint queries
    const altsParam = (validPoints.length === 2 && (showAlternatives || routePreference === 'shortest')) ? '3' : 'false';

    const coordsStr = validPoints.map((p) => `${p.lng},${p.lat}`).join(';');
    let url = `http://${window.location.hostname}:${port}/route/v1/${profileName}/${coordsStr}?overview=full&geometries=geojson&annotations=nodes,speed&steps=true&alternatives=${altsParam}`;
    if (avoidTolls && profile === 'car') {
      url += '&exclude=toll';
    }
    setRawRequestUrl(url);

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setRawJson(data);
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          // Snap validation on endpoints
          const snapStart = L.latLng(data.waypoints[0].location[1], data.waypoints[0].location[0]);
          const snapEnd = L.latLng(data.waypoints[data.waypoints.length - 1].location[1], data.waypoints[data.waypoints.length - 1].location[0]);

          if (startPoint && startPoint.distanceTo(snapStart) > 3000) {
            setRouteError('Start point dropped outside installed OSRM region.');
            setRouteCoordinates([]);
            setAltRoutes([]);
            setMainRouteInfo(null);
            return;
          }
          if (endPoint && endPoint.distanceTo(snapEnd) > 3000) {
            setRouteError('Destination dropped outside installed OSRM region.');
            setRouteCoordinates([]);
            setAltRoutes([]);
            setMainRouteInfo(null);
            return;
          }

          setRouteError(null);
          setAllRoutes(data.routes);

          let primaryIdx = 0;
          if (routePreference === 'shortest') {
            let minDistance = Infinity;
            data.routes.forEach((r: any, idx: number) => {
              if (r.distance < minDistance) {
                minDistance = r.distance;
                primaryIdx = idx;
              }
            });
          }
          applySelectedRoute(data.routes, primaryIdx);
        } else {
          setRouteCoordinates([]);
          setAltRoutes([]);
          setMainRouteInfo(null);
          setRouteNodes([]);
          setRouteSteps([]);
          setRouteError(data.message || 'No route found between these points.');
        }
      })
      .catch((err) => {
        console.error('OSRM route error:', err);
        setRouteCoordinates([]);
        setAltRoutes([]);
        setMainRouteInfo(null);
        setRouteError('Failed to connect to OSRM routing engine.');
      });
  };

  const applySelectedRoute = (routesList: any[], primaryIndex: number) => {
    setSelectedRouteIndex(primaryIndex);
    const primaryRoute = routesList[primaryIndex];
    const coords: [number, number][] = primaryRoute.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
    setRouteCoordinates(coords);

    // Alternative routes (if 2 points)
    const alts = routesList
      .map((r: any, idx: number) => {
        if (idx === primaryIndex) return null;
        const altCoords: [number, number][] = r.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
        const distMiles = (r.distance / 1609.34).toFixed(1);
        const durationMins = Math.ceil(r.duration / 60);
        const viaName = r.legs?.[0]?.steps?.find((s: any) => s.name && s.name.length > 2)?.name || 'Alternate';
        return {
          coords: altCoords,
          distance: `${distMiles} mi`,
          duration: `${durationMins} min`,
          via: viaName,
          index: idx
        };
      })
      .filter(Boolean) as any[];

    setAltRoutes(showAlternatives ? alts : []);

    const distMiles = (primaryRoute.distance / 1609.34).toFixed(1);
    const durationMins = Math.ceil(primaryRoute.duration / 60);
    const viaRoad = primaryRoute.legs?.[0]?.steps?.find((s: any) => s.name && s.name.length > 2)?.name || 'Fastest Route';

    setMainRouteInfo({
      distance: `${distMiles} mi`,
      duration: `${durationMins} min`,
      via: viaRoad
    });

    if (coords.length > 0) {
      setRouteBounds(L.polyline(coords).getBounds());
    }

    // Flatten turn-by-turn steps across all route legs
    if (primaryRoute.legs) {
      const allLegSteps = primaryRoute.legs.flatMap((leg: any) => leg.steps || []);
      setRouteSteps(allLegSteps);

      const roadNames = new Set(
        allLegSteps.slice(0, -1)
          .map((s: any) => s.name || s.ref || '')
          .filter((name: string) => name && name.toLowerCase() !== 'unnamed')
      );
      setIsSameRoad(roadNames.size <= 1);
      if (roadNames.size > 0) {
        setRoadName(Array.from(roadNames)[0] as string);
      } else {
        setRoadName('');
      }

      if (primaryRoute.legs[0]?.annotation) {
        if (primaryRoute.legs[0].annotation.nodes) {
          setRouteNodes(primaryRoute.legs[0].annotation.nodes);
        }
        if (primaryRoute.legs[0].annotation.speed && primaryRoute.legs[0].annotation.speed.length > 0) {
          const speedMs = primaryRoute.legs[0].annotation.speed[0];
          const speedMph = Math.round(speedMs * 2.23694);
          setNewSpeed(speedMph);
          setBackSpeed(speedMph);
        }
      }
    }
  };

  useEffect(() => {
    const validPoints = [startPoint, ...stops.map((s) => s.point), endPoint].filter(Boolean);
    if (validPoints.length >= 2) {
      fetchRoute();
    }
  }, [startPoint, endPoint, stops, profile, showAlternatives, avoidTolls, routePreference]);

  // ==========================================================================
  // Map Interaction Handlers (Draggable Markers & Context Menu)
  // ==========================================================================

  const handleMapClick = async (latlng: L.LatLng) => {
    setContextMenu(null);

    if (panelMode === 'directions') {
      // Check if user clicked an empty stop input first
      if (activeInputFocus && activeInputFocus.startsWith('stop-')) {
        updateStopPoint(activeInputFocus, latlng);
        setActiveInputFocus(null);
        return;
      }

      if (!startPoint) {
        setStartPoint(latlng);
        setStartInputText(`${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`);
        const geo = await reverseGeocode(latlng.lat, latlng.lng, dockerStatus, activeEngine);
        if (geo.formattedAddress) setStartInputText(geo.formattedAddress);
        if (geo.city) setCityName(geo.city);
      } else {
        // Check for any empty intermediate stop
        const emptyStop = stops.find((s) => !s.point);
        if (emptyStop) {
          updateStopPoint(emptyStop.id, latlng);
        } else if (!endPoint) {
          setEndPoint(latlng);
          setEndInputText(`${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`);
          const geo = await reverseGeocode(latlng.lat, latlng.lng, dockerStatus, activeEngine);
          if (geo.formattedAddress) setEndInputText(geo.formattedAddress);
        }
      }
    } else {
      // In search mode: drop place pin & inspect "What's here?"
      setActivePlace({
        title: 'Dropped Pin',
        subtitle: `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`,
        lat: latlng.lat,
        lng: latlng.lng
      });

      const geo = await reverseGeocode(latlng.lat, latlng.lng, dockerStatus, activeEngine);
      if (geo.formattedAddress) {
        setActivePlace({
          title: geo.road || geo.city || 'Dropped Pin',
          subtitle: geo.formattedAddress,
          lat: latlng.lat,
          lng: latlng.lng
        });
      }
      if (geo.city) setCityName(geo.city);
    }
    setActiveInputFocus(null);
  };

  /**
   * Position the context menu right beside the mouse click,
   * calculated against the map container's bounding rectangle.
   */
  const handleMapContextMenu = (e: L.LeafletMouseEvent) => {
    const container = mapInstanceRef.current?.getContainer();
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const rawX = e.originalEvent.clientX - rect.left;
    const rawY = e.originalEvent.clientY - rect.top;

    const menuWidth = 220;
    const menuHeight = 250;
    const cWidth = container.clientWidth;
    const cHeight = container.clientHeight;

    // Flip inward if clicked close to container edges
    const x = (rawX + menuWidth > cWidth) ? Math.max(8, rawX - menuWidth) : rawX;
    const y = (rawY + menuHeight > cHeight) ? Math.max(8, rawY - menuHeight) : rawY;

    setContextMenu({
      x,
      y,
      latlng: e.latlng
    });
  };

  const handleDragStartMarker = async (newLatLng: L.LatLng) => {
    setStartPoint(newLatLng);
    setStartInputText(`${newLatLng.lat.toFixed(5)}, ${newLatLng.lng.toFixed(5)}`);
    const geo = await reverseGeocode(newLatLng.lat, newLatLng.lng, dockerStatus, activeEngine);
    if (geo.formattedAddress) setStartInputText(geo.formattedAddress);
    if (geo.city) setCityName(geo.city);
  };

  const handleDragEndMarker = async (newLatLng: L.LatLng) => {
    setEndPoint(newLatLng);
    setEndInputText(`${newLatLng.lat.toFixed(5)}, ${newLatLng.lng.toFixed(5)}`);
    const geo = await reverseGeocode(newLatLng.lat, newLatLng.lng, dockerStatus, activeEngine);
    if (geo.formattedAddress) setEndInputText(geo.formattedAddress);
  };

  // Google Maps My Location GPS Button
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const userLatLng = L.latLng(lat, lng);
        setUserLocation(userLatLng);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.flyTo(userLatLng, 15, { duration: 1.5 });
        }
        showToast('Located your current position.');
      },
      () => {
        showToast('Unable to retrieve your location.');
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  };

  // Road Editor submission
  const applyRoadEdit = async () => {
    if (routeNodes.length < 2) return;
    if (!editReason.trim()) {
      showToast('Please provide a reason for this edit.');
      return;
    }

    const from_node = routeNodes.join(',');
    const to_node = '';
    const editLat = routeCoordinates[0][0];
    const editLng = routeCoordinates[0][1];
    const edits: any[] = [];

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
      edits.push({
        from_node: [...routeNodes].reverse().join(','),
        to_node: '',
        speed_kmh: isBackClosing ? 0 : Math.round(backSpeed * 1.60934),
        is_closed: isBackClosing,
        is_bidirectional: false,
        reason: `[Backward] ${editReason.trim()}`,
        lat: routeCoordinates[routeCoordinates.length - 1][0],
        lng: routeCoordinates[routeCoordinates.length - 1][1],
        geometry: JSON.stringify([...routeCoordinates].reverse()),
        road_name: roadName,
        city_name: cityName
      });
    }

    try {
      for (const payload of edits) {
        await fetch(`/api/overrides`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      showToast('Road edit applied! Rebuilding routing graph...');
      setEditReason('');
      fetchOverrides();
      window.dispatchEvent(new Event('edit-applied'));
      setTimeout(fetchRoute, 3000);
    } catch {
      showToast('Failed to apply road edit.');
    }
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }} onClick={() => setContextMenu(null)}>
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className="animate-fade-in"
          style={{
            position: 'fixed',
            top: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--gmaps-bg)',
            color: 'var(--gmaps-text)',
            padding: '10px 20px',
            borderRadius: '24px',
            boxShadow: 'var(--gmaps-shadow-lg)',
            border: '1px solid var(--gmaps-border)',
            fontSize: '13px',
            fontWeight: 500,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span style={{ color: 'var(--gmaps-blue)' }}>ℹ️</span> {toastMessage}
        </div>
      )}

      {/* Route Error Notification */}
      {routeError && (
        <div
          className="animate-fade-in"
          style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2000,
            background: 'var(--gmaps-bg)',
            color: 'var(--gmaps-red)',
            padding: '10px 20px',
            borderRadius: '8px',
            boxShadow: 'var(--gmaps-shadow-lg)',
            border: '1px solid var(--gmaps-border)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '13px',
            fontWeight: 500
          }}
        >
          <span>⚠️</span> {routeError}
          <button
            onClick={() => setRouteError(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--gmaps-subtext)', cursor: 'pointer', marginLeft: '6px' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ====================================================================
          LEAFLET MAP CONTAINER
          ==================================================================== */}
      <MapContainer
        center={defaultCenter}
        zoom={13}
        style={{ height: '100%', width: '100%', background: 'var(--bg-color)' }}
        zoomControl={false}
      >
        <MapControllerBridge
          onMapReady={(map) => { mapInstanceRef.current = map; }}
          onMapClick={handleMapClick}
          onContextMenu={handleMapContextMenu}
        />
        <MapFitter bounds={routeBounds} />

        {/* Dynamic Base Map Tile Layer */}
        {mapLayer === 'osm' ? (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        ) : (
          <TileLayer
            attribution='&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        )}

        {/* Selected State Boundary Highlight */}
        {selectedState && (
          <GeoJSON
            key={`geojson-${selectedState}`}
            data={(usStatesGeoJson as any).features.filter((f: any) => f.properties.name.toLowerCase().replace(/ /g, '-') === selectedState)}
            style={{ color: '#1a73e8', fillOpacity: 0.04, weight: 2, dashArray: '4, 8' }}
          />
        )}

        {/* Start Point Marker (Draggable) */}
        {startPoint && (
          <Marker
            position={startPoint}
            icon={gmapsStartIcon}
            draggable={true}
            eventHandlers={{
              dragend: (e) => handleDragStartMarker(e.target.getLatLng())
            }}
          />
        )}

        {/* Intermediate Stops Markers (Draggable) */}
        {stops.map((stop, sIdx) =>
          stop.point ? (
            <Marker
              key={stop.id}
              position={stop.point}
              icon={createGmapsStopIcon(sIdx + 1)}
              draggable={true}
              eventHandlers={{
                dragend: (e) => updateStopPoint(stop.id, e.target.getLatLng())
              }}
            />
          ) : null
        )}

        {/* Destination Point Marker (Draggable) */}
        {endPoint && (
          <Marker
            position={endPoint}
            icon={gmapsEndIcon}
            draggable={true}
            eventHandlers={{
              dragend: (e) => handleDragEndMarker(e.target.getLatLng())
            }}
          />
        )}

        {/* Active Place Marker (Always visible when "What's here?" or search is active) */}
        {activePlace && (
          <Marker
            position={L.latLng(activePlace.lat, activePlace.lng)}
            icon={gmapsPlaceIcon}
          />
        )}

        {/* User GPS Location Marker */}
        {userLocation && (
          <Marker position={userLocation} icon={gmapsGpsIcon} />
        )}

        {/* Alternative Routes (Gray with hover click-to-activate) */}
        {altRoutes.map((alt) => (
          <React.Fragment key={`alt-${alt.index}`}>
            <Polyline
              positions={alt.coords}
              color="#5f6368"
              weight={8}
              opacity={0.7}
              eventHandlers={{
                click: () => applySelectedRoute(allRoutes, alt.index)
              }}
            />
            <Polyline
              positions={alt.coords}
              color="#9aa0a6"
              weight={5}
              opacity={0.9}
              eventHandlers={{
                click: () => applySelectedRoute(allRoutes, alt.index)
              }}
            >
              <Tooltip direction="center" className="alt-route-tooltip">
                <div>{alt.duration}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{alt.distance}</div>
              </Tooltip>
            </Polyline>
          </React.Fragment>
        ))}

        {/* Main Route (Iconic Google Blue) */}
        {routeCoordinates.length > 0 && (
          <>
            <Polyline positions={routeCoordinates} color="#1558d6" weight={9} opacity={0.85} />
            <Polyline positions={routeCoordinates} color="#1a73e8" weight={6} opacity={1.0}>
              {mainRouteInfo && (
                <Tooltip permanent direction="center" className="main-route-tooltip">
                  <div>{mainRouteInfo.duration}</div>
                  <div style={{ fontSize: '10px', opacity: 0.85 }}>{mainRouteInfo.distance}</div>
                </Tooltip>
              )}
            </Polyline>
          </>
        )}

        {/* Road Editor Overrides Display */}
        {activeOverrides.map((ov) => {
          if (ov.geometry) {
            try {
              const coords = JSON.parse(ov.geometry);
              const color = ov.is_closed ? '#ea4335' : '#fbbc04';
              return <Polyline key={ov.id} positions={coords} color={color} weight={7} opacity={0.85} dashArray="8, 8" />;
            } catch {
              return null;
            }
          }
          return null;
        })}
      </MapContainer>

      {/* ====================================================================
          TOP-LEFT FLOATING GOOGLE MAPS PANEL (SEARCH & DIRECTIONS)
          ==================================================================== */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          zIndex: 1000,
          width: '392px',
          maxWidth: 'calc(100vw - 32px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        {panelMode === 'search' ? (
          /* Search Bar Mode */
          <div className="gmaps-card" style={{ padding: '4px 8px 4px 14px', display: 'flex', alignItems: 'center', height: '48px' }}>
            <Search size={20} color="var(--gmaps-subtext)" style={{ flexShrink: 0, marginRight: '10px' }} />
            <input
              type="text"
              placeholder={isSearching ? "Searching local database..." : `Search places with ${activeGeocoderName}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setActiveInputFocus('search')}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--gmaps-text)',
                fontSize: '15px',
                fontFamily: 'Inter, sans-serif'
              }}
            />

            <span
              title={`Geocoding exclusively served by installed ${activeGeocoderName} instance`}
              style={{
                fontSize: '10px',
                padding: '2px 7px',
                borderRadius: '12px',
                background: isGeocoderOnline ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: isGeocoderOnline ? '#10b981' : '#ef4444',
                fontWeight: 700,
                letterSpacing: '0.3px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginRight: '6px',
                whiteSpace: 'nowrap',
                userSelect: 'none'
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isGeocoderOnline ? '#10b981' : '#ef4444' }} />
              {activeGeocoderName}
            </span>

            {isSearching && (
              <div
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  border: '2px solid var(--gmaps-blue)',
                  borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite',
                  marginRight: '6px'
                }}
              />
            )}

            {searchQuery && (
              <button
                className="gmaps-icon-btn"
                style={{ width: '32px', height: '32px', marginRight: '6px' }}
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setActivePlace(null);
                }}
                title="Clear search"
              >
                <X size={18} />
              </button>
            )}

            <div style={{ width: '1px', height: '24px', background: 'var(--gmaps-border)', margin: '0 8px' }} />

            {/* Google Maps Blue Directions Button */}
            <button
              className="gmaps-btn-directions"
              onClick={() => {
                setPanelMode('directions');
                if (activePlace && !endPoint) {
                  setEndPoint(L.latLng(activePlace.lat, activePlace.lng));
                  setEndInputText(activePlace.title || activePlace.subtitle);
                }
              }}
              title="Directions"
            >
              <Navigation size={18} fill="#ffffff" />
            </button>
          </div>
        ) : (
          /* Directions Mode */
          <div className="gmaps-card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Directions Header with Mode Tabs & Clear All */}
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--gmaps-border)', padding: '4px 8px' }}>
              <button
                className="gmaps-icon-btn"
                style={{ width: '36px', height: '36px', marginRight: '8px' }}
                onClick={() => {
                  setPanelMode('search');
                  setStartSuggestions([]);
                  setEndSuggestions([]);
                  setStopSuggestions([]);
                }}
                title="Back to search"
              >
                <ArrowLeft size={18} />
              </button>

              <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                <button
                  className={`gmaps-mode-tab ${profile === 'car' ? 'active' : ''}`}
                  onClick={() => setProfile('car')}
                  title="Driving mode"
                >
                  <Car size={16} />
                  <span>Driving</span>
                </button>
                <button
                  className={`gmaps-mode-tab ${profile === 'foot' ? 'active' : ''}`}
                  onClick={() => setProfile('foot')}
                  title="Walking mode"
                >
                  <Footprints size={16} />
                  <span>Walking</span>
                </button>
              </div>

              {(startPoint || endPoint || stops.length > 0 || routeCoordinates.length > 0) && (
                <button
                  className="gmaps-icon-btn"
                  style={{ width: '36px', height: '36px', color: 'var(--gmaps-red)' }}
                  onClick={clearAllPinsAndRoute}
                  title="Clear all points and routes"
                >
                  <Trash2 size={16} />
                </button>
              )}

              <button
                className="gmaps-icon-btn"
                style={{ width: '36px', height: '36px' }}
                onClick={() => setShowOptionsBar(!showOptionsBar)}
                title="Route options"
              >
                <Sliders size={16} />
              </button>
            </div>

            {/* Origin, Stops & Destination Inputs with Google Maps Connection Line */}
            <div style={{ position: 'relative', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Dotted vertical connector line */}
              <div
                style={{
                  position: 'absolute',
                  left: '23px',
                  top: '26px',
                  bottom: '50px',
                  width: '2px',
                  borderLeft: '2px dotted var(--gmaps-subtext)',
                  zIndex: 0
                }}
              />

              {/* Start Point Input Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative', zIndex: 1 }}>
                <div
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    border: '3px solid #188038',
                    background: 'var(--gmaps-bg)',
                    flexShrink: 0
                  }}
                />
                <div className="gmaps-input-container" style={{ flex: 1, height: '36px', padding: '0 8px' }}>
                  <input
                    type="text"
                    placeholder="Choose starting point, or click map..."
                    value={startInputText}
                    onChange={(e) => setStartInputText(e.target.value)}
                    onFocus={() => setActiveInputFocus('start')}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'var(--gmaps-text)',
                      fontSize: '13px'
                    }}
                  />
                  {startInputText && (
                    <button
                      className="gmaps-icon-btn"
                      style={{ width: '22px', height: '22px' }}
                      onClick={() => {
                        setStartPoint(null);
                        setStartInputText('');
                        setRouteCoordinates([]);
                        setAltRoutes([]);
                        setMainRouteInfo(null);
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Intermediate Stops Rows */}
              {stops.map((stop, sIdx) => (
                <div key={stop.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative', zIndex: 1 }}>
                  <div
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      border: '3px solid #1a73e8',
                      background: 'var(--gmaps-bg)',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  />
                  <div className="gmaps-input-container" style={{ flex: 1, height: '36px', padding: '0 8px' }}>
                    <input
                      type="text"
                      placeholder={`Stop ${sIdx + 1} - click map or type address...`}
                      value={stop.text}
                      onChange={(e) => updateStopText(stop.id, e.target.value)}
                      onFocus={() => setActiveInputFocus(stop.id)}
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        color: 'var(--gmaps-text)',
                        fontSize: '13px'
                      }}
                    />
                    <button
                      className="gmaps-icon-btn"
                      style={{ width: '22px', height: '22px' }}
                      onClick={() => removeDestinationStop(stop.id)}
                      title="Remove this stop"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}

              {/* Destination Point Input Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', position: 'relative', zIndex: 1 }}>
                <MapPin size={16} color="#ea4335" style={{ flexShrink: 0 }} />
                <div className="gmaps-input-container" style={{ flex: 1, height: '36px', padding: '0 8px' }}>
                  <input
                    type="text"
                    placeholder="Choose destination, or click map..."
                    value={endInputText}
                    onChange={(e) => setEndInputText(e.target.value)}
                    onFocus={() => setActiveInputFocus('end')}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: 'var(--gmaps-text)',
                      fontSize: '13px'
                    }}
                  />
                  {endInputText && (
                    <button
                      className="gmaps-icon-btn"
                      style={{ width: '22px', height: '22px' }}
                      onClick={() => {
                        setEndPoint(null);
                        setEndInputText('');
                        setRouteCoordinates([]);
                        setAltRoutes([]);
                        setMainRouteInfo(null);
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Swap Origin & Destination Button */}
                <button
                  className="gmaps-icon-btn"
                  style={{ width: '32px', height: '32px', border: '1px solid var(--gmaps-border)', borderRadius: '50%' }}
                  onClick={() => {
                    const tempPt = startPoint;
                    const tempText = startInputText;
                    setStartPoint(endPoint);
                    setStartInputText(endInputText);
                    setEndPoint(tempPt);
                    setEndInputText(tempText);
                  }}
                  title="Reverse start and destination"
                >
                  <ArrowUpDown size={15} />
                </button>
              </div>

              {/* + Add Destination Button (Google Maps Style) */}
              <div style={{ display: 'flex', alignItems: 'center', marginLeft: '24px', marginTop: '2px' }}>
                <button
                  onClick={addDestinationStop}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--gmaps-subtext)',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    transition: 'color 0.15s ease'
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.color = 'var(--gmaps-blue)')}
                  onMouseOut={(e) => (e.currentTarget.style.color = 'var(--gmaps-subtext)')}
                >
                  <Plus size={15} />
                  <span>Add destination</span>
                </button>
              </div>

              {/* Expandable Route Options */}
              {showOptionsBar && (
                <div
                  className="animate-fade-in"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '6px',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--gmaps-border)',
                    marginTop: '2px'
                  }}
                >
                  <button
                    onClick={() => setRoutePreference(routePreference === 'fastest' ? 'shortest' : 'fastest')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '16px',
                      border: '1px solid var(--gmaps-border)',
                      background: routePreference === 'fastest' ? 'var(--gmaps-active)' : 'transparent',
                      color: routePreference === 'fastest' ? 'var(--gmaps-blue)' : 'var(--gmaps-subtext)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Preference: {routePreference === 'fastest' ? '⚡ Fastest' : '📏 Shortest'}
                  </button>

                  {profile === 'car' && (
                    <button
                      onClick={() => setAvoidTolls(!avoidTolls)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '16px',
                        border: '1px solid var(--gmaps-border)',
                        background: avoidTolls ? 'var(--gmaps-active)' : 'transparent',
                        color: avoidTolls ? 'var(--gmaps-blue)' : 'var(--gmaps-subtext)',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {avoidTolls ? '✓ Avoid Tolls' : 'Avoid Tolls'}
                    </button>
                  )}

                  {stops.length === 0 && (
                    <button
                      onClick={() => setShowAlternatives(!showAlternatives)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '16px',
                        border: '1px solid var(--gmaps-border)',
                        background: showAlternatives ? 'var(--gmaps-active)' : 'transparent',
                        color: showAlternatives ? 'var(--gmaps-blue)' : 'var(--gmaps-subtext)',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {showAlternatives ? '✓ Alternatives' : 'Alternatives'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Route Cards & Results */}
            {mainRouteInfo && !routeError && (
              <div
                style={{
                  borderTop: '1px solid var(--gmaps-border)',
                  background: 'var(--gmaps-panel-bg)',
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: '420px',
                  overflowY: 'auto'
                }}
                className="custom-scrollbar"
              >
                {/* Primary Route Card */}
                <div
                  className={`gmaps-route-card ${selectedRouteIndex === 0 ? 'selected' : ''}`}
                  style={{ margin: '8px 12px 4px 12px' }}
                  onClick={() => applySelectedRoute(allRoutes, 0)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                        <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--gmaps-green)' }}>
                          {mainRouteInfo.duration}
                        </span>
                        <span style={{ fontSize: '13px', color: 'var(--gmaps-subtext)' }}>
                          ({mainRouteInfo.distance})
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--gmaps-text)', marginTop: '2px', fontWeight: 500 }}>
                        {stops.length > 0 ? `${stops.length + 1} legs route` : 'Fastest route'} &bull; via {mainRouteInfo.via}
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowSteps(!showSteps);
                      }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '16px',
                        border: '1px solid var(--gmaps-border)',
                        background: showSteps ? 'var(--gmaps-blue)' : 'transparent',
                        color: showSteps ? '#ffffff' : 'var(--gmaps-text)',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {showSteps ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      Details
                    </button>
                  </div>
                </div>

                {/* Alternative Routes Cards (shown when no intermediate stops) */}
                {stops.length === 0 && altRoutes.map((alt) => (
                  <div
                    key={`card-alt-${alt.index}`}
                    className={`gmaps-route-card ${selectedRouteIndex === alt.index ? 'selected' : ''}`}
                    style={{ margin: '4px 12px' }}
                    onClick={() => applySelectedRoute(allRoutes, alt.index)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                          <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--gmaps-text)' }}>
                            {alt.duration}
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--gmaps-subtext)' }}>
                            ({alt.distance})
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--gmaps-subtext)', marginTop: '1px' }}>
                          via {alt.via}
                        </div>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--gmaps-blue)', fontWeight: 600 }}>Select</span>
                    </div>
                  </div>
                ))}

                {/* Turn-by-Turn Navigation List */}
                {showSteps && routeSteps.length > 0 && (
                  <div style={{ padding: '8px 14px', borderTop: '1px solid var(--gmaps-border)', marginTop: '6px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gmaps-subtext)', marginBottom: '8px' }}>
                      Turn-by-turn directions
                    </div>
                    {routeSteps.map((step, idx) => {
                      const distStr = step.distance < 160.9 ? `${Math.round(step.distance * 3.28084)} ft` : `${(step.distance / 1609.34).toFixed(1)} mi`;
                      const isArrive = step.maneuver.type === 'arrive';
                      const isDepart = step.maneuver.type === 'depart';
                      const modifier = step.maneuver.modifier || '';

                      return (
                        <div
                          key={`step-${idx}`}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '12px',
                            padding: '8px 0',
                            borderBottom: idx < routeSteps.length - 1 ? '1px solid var(--gmaps-border)' : 'none'
                          }}
                        >
                          <div style={{ color: isArrive ? '#ea4335' : 'var(--gmaps-blue)', marginTop: '2px' }}>
                            {isArrive ? (
                              <MapPin size={16} />
                            ) : modifier.includes('left') ? (
                              <CornerUpLeft size={16} />
                            ) : modifier.includes('right') ? (
                              <CornerUpRight size={16} />
                            ) : modifier.includes('uturn') ? (
                              <RotateCcw size={16} />
                            ) : (
                              <ArrowUp size={16} />
                            )}
                          </div>
                          <div style={{ flex: 1, fontSize: '12px', color: 'var(--gmaps-text)', lineHeight: 1.4 }}>
                            {isArrive ? (
                              <strong>Arrive at destination</strong>
                            ) : isDepart ? (
                              <span>Head {modifier || 'forward'} on <strong>{step.name || 'road'}</strong></span>
                            ) : (
                              <span>
                                {step.maneuver.type.replace('-', ' ')} {modifier ? modifier.replace('-', ' ') : ''}
                                {step.name ? ` onto ${step.name}` : ''}
                              </span>
                            )}
                          </div>
                          {step.distance > 0 && (
                            <span style={{ fontSize: '11px', color: 'var(--gmaps-subtext)', whiteSpace: 'nowrap' }}>
                              {distStr}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Route Actions Bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderTop: '1px solid var(--gmaps-border)',
                    background: 'var(--gmaps-bg)'
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setShowRawJson(true)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '4px',
                        border: '1px solid var(--gmaps-border)',
                        background: 'transparent',
                        color: 'var(--gmaps-text)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: 500
                      }}
                    >
                      JSON
                    </button>
                    {isSameRoad && profile === 'car' && (
                      <button
                        onClick={() => setIsToolsOpen(true)}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '4px',
                          border: 'none',
                          background: 'var(--gmaps-blue)',
                          color: '#ffffff',
                          fontSize: '11px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Wrench size={12} /> Edit Road
                      </button>
                    )}
                  </div>

                  <button
                    onClick={clearAllPinsAndRoute}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--gmaps-red)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Trash2 size={13} /> Clear route
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Autocomplete Dropdown List */}
        {((panelMode === 'search' && (searchResults.length > 0 || (searchQuery.trim().length > 1 && !isSearching && activeInputFocus === 'search'))) ||
          (activeInputFocus === 'start' && startSuggestions.length > 0) ||
          (activeInputFocus === 'end' && endSuggestions.length > 0) ||
          (activeInputFocus?.startsWith('stop-') && stopSuggestions.length > 0)) && (
          <div
            className="gmaps-card animate-fade-in"
            style={{
              padding: '6px 0',
              maxHeight: '280px',
              overflowY: 'auto'
            }}
          >
            {panelMode === 'search' && searchResults.length === 0 && !isSearching && searchQuery.trim().length > 1 && activeInputFocus === 'search' ? (
              <div style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--gmaps-subtext)', textAlign: 'center' }}>
                No places found in installed <strong style={{ color: 'var(--gmaps-text)' }}>{activeGeocoderName}</strong> for &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              (activeInputFocus === 'start'
                ? startSuggestions
                : activeInputFocus === 'end'
                ? endSuggestions
                : activeInputFocus?.startsWith('stop-')
                ? stopSuggestions
                : searchResults
              ).map((item) => (
              <div
                key={item.id}
                className="gmaps-dropdown-item"
                onClick={() => {
                  const pt = L.latLng(item.lat, item.lng);
                  if (activeInputFocus === 'start') {
                    setStartPoint(pt);
                    setStartInputText(item.title);
                    setStartSuggestions([]);
                  } else if (activeInputFocus === 'end') {
                    setEndPoint(pt);
                    setEndInputText(item.title);
                    setEndSuggestions([]);
                  } else if (activeInputFocus?.startsWith('stop-')) {
                    updateStopPoint(activeInputFocus, pt, item.title);
                    setStopSuggestions([]);
                  } else {
                    // Search bar selection
                    setActivePlace(item);
                    setSearchResults([]);
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.flyTo(pt, 14, { duration: 1.2 });
                    }
                  }
                  setActiveInputFocus(null);
                }}
              >
                <MapPin size={18} color="var(--gmaps-subtext)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gmaps-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--gmaps-subtext)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.subtitle}
                  </div>
                </div>
              </div>
            )))}
          </div>
        )}
      </div>

      {/* ====================================================================
          FLOATING GOOGLE MAPS PLACE CARD ("WHAT'S HERE?" OR SEARCH SELECTION)
          Appears floating over bottom-center of map in any mode
          ==================================================================== */}
      {activePlace && (
        <div
          className="gmaps-card animate-fade-in"
          style={{
            position: 'absolute',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            minWidth: '320px',
            maxWidth: 'calc(100vw - 48px)',
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            boxShadow: 'var(--gmaps-shadow-lg)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <MapPin size={22} color="#ea4335" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--gmaps-text)' }}>
                  {activePlace.title}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--gmaps-subtext)', marginTop: '2px' }}>
                  {activePlace.subtitle}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--gmaps-subtext)', marginTop: '2px', opacity: 0.85 }}>
                  {activePlace.lat.toFixed(5)}, {activePlace.lng.toFixed(5)}
                </div>
              </div>
            </div>
            <button
              className="gmaps-icon-btn"
              style={{ width: '28px', height: '28px' }}
              onClick={() => setActivePlace(null)}
              title="Close place card"
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
            <button
              onClick={() => {
                setPanelMode('directions');
                setEndPoint(L.latLng(activePlace.lat, activePlace.lng));
                setEndInputText(activePlace.subtitle || `${activePlace.lat.toFixed(5)}, ${activePlace.lng.toFixed(5)}`);
                setActivePlace(null);
              }}
              style={{
                flex: 1,
                background: '#1a73e8',
                color: '#ffffff',
                border: 'none',
                borderRadius: '20px',
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <Navigation size={14} fill="#ffffff" /> Directions
            </button>

            <button
              onClick={() => {
                setPanelMode('directions');
                setStartPoint(L.latLng(activePlace.lat, activePlace.lng));
                setStartInputText(activePlace.subtitle || `${activePlace.lat.toFixed(5)}, ${activePlace.lng.toFixed(5)}`);
                setActivePlace(null);
              }}
              style={{
                background: 'var(--gmaps-hover)',
                color: 'var(--gmaps-text)',
                border: '1px solid var(--gmaps-border)',
                borderRadius: '20px',
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Start here
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          BOTTOM-LEFT GOOGLE MAPS LAYER SWITCHER (MAP / SATELLITE)
          ==================================================================== */}
      <div style={{ position: 'absolute', bottom: '24px', left: '24px', zIndex: 1000 }}>
        <div
          className="gmaps-layer-thumbnail"
          onClick={() => setMapLayer(mapLayer === 'osm' ? 'satellite' : 'osm')}
          title={mapLayer === 'osm' ? 'Switch to Satellite view' : 'Switch to Map view'}
        >
          <img
            src={
              mapLayer === 'osm'
                ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/13/3175/2374'
                : 'https://tile.openstreetmap.org/13/2374/3175.png'
            }
            alt={mapLayer === 'osm' ? 'Satellite Preview' : 'Map Preview'}
          />
          <div className="gmaps-layer-label">
            {mapLayer === 'osm' ? 'Satellite' : 'Map'}
          </div>
        </div>
      </div>

      {/* ====================================================================
          BOTTOM-RIGHT GOOGLE MAPS CONTROLS (+/- ZOOM, GPS MY LOCATION)
          Accurately right-aligned to screen margin
          ==================================================================== */}
      <div
        style={{
          position: 'absolute',
          bottom: '24px',
          right: '16px',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '10px'
        }}
      >
        {/* GeoOps Tools Floating Button */}
        <button
          onClick={() => setIsToolsOpen(!isToolsOpen)}
          className="gmaps-card"
          style={{
            padding: '8px 14px',
            borderRadius: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            border: '1px solid var(--gmaps-border)',
            boxShadow: 'var(--gmaps-shadow)'
          }}
          title="GeoOps Engine & Road Tools"
        >
          <Wrench size={14} color="var(--gmaps-blue)" />
          <span>GeoOps Tools</span>
          {activeOverrides.length > 0 && (
            <span
              style={{
                background: '#ea4335',
                color: '#ffffff',
                borderRadius: '10px',
                padding: '1px 6px',
                fontSize: '10px'
              }}
            >
              {activeOverrides.length}
            </span>
          )}
        </button>

        {/* GPS My Location Crosshair Button */}
        <button
          className="gmaps-card gmaps-control-btn"
          style={{ borderRadius: '50%', boxShadow: 'var(--gmaps-shadow)' }}
          onClick={handleLocateMe}
          title="Your location"
        >
          <LocateFixed size={18} />
        </button>

        {/* Zoom In & Zoom Out Stack */}
        <div
          className="gmaps-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: '8px',
            boxShadow: 'var(--gmaps-shadow)'
          }}
        >
          <button
            className="gmaps-control-btn"
            onClick={() => mapInstanceRef.current?.zoomIn()}
            title="Zoom in"
          >
            <Plus size={18} />
          </button>
          <div style={{ height: '1px', background: 'var(--gmaps-border)', width: '100%' }} />
          <button
            className="gmaps-control-btn"
            onClick={() => mapInstanceRef.current?.zoomOut()}
            title="Zoom out"
          >
            <Minus size={18} />
          </button>
        </div>
      </div>

      {/* ====================================================================
          RIGHT-CLICK GOOGLE MAPS CONTEXT MENU
          Positioned accurately right beside the mouse click
          ==================================================================== */}
      {contextMenu && (
        <div
          className="gmaps-context-menu"
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="gmaps-context-item"
            onClick={() => {
              setPanelMode('directions');
              setStartPoint(contextMenu.latlng);
              setStartInputText(`${contextMenu.latlng.lat.toFixed(5)}, ${contextMenu.latlng.lng.toFixed(5)}`);
              setContextMenu(null);
              reverseGeocode(contextMenu.latlng.lat, contextMenu.latlng.lng, dockerStatus, activeEngine).then((geo) => {
                if (geo.formattedAddress) setStartInputText(geo.formattedAddress);
                if (geo.city) setCityName(geo.city);
              });
            }}
          >
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid #188038' }} />
            <span>Directions from here</span>
          </div>

          <div
            className="gmaps-context-item"
            onClick={() => {
              setPanelMode('directions');
              setEndPoint(contextMenu.latlng);
              setEndInputText(`${contextMenu.latlng.lat.toFixed(5)}, ${contextMenu.latlng.lng.toFixed(5)}`);
              setContextMenu(null);
              reverseGeocode(contextMenu.latlng.lat, contextMenu.latlng.lng, dockerStatus, activeEngine).then((geo) => {
                if (geo.formattedAddress) setEndInputText(geo.formattedAddress);
              });
            }}
          >
            <MapPin size={14} color="#ea4335" />
            <span>Directions to here</span>
          </div>

          {/* Add Destination / Stop option */}
          <div
            className="gmaps-context-item"
            onClick={() => {
              setPanelMode('directions');
              const pt = contextMenu.latlng;
              setContextMenu(null);
              if (!startPoint) {
                setStartPoint(pt);
                setStartInputText(`${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`);
                reverseGeocode(pt.lat, pt.lng, dockerStatus, activeEngine).then((g) => {
                  if (g.formattedAddress) setStartInputText(g.formattedAddress);
                });
              } else if (!endPoint) {
                setEndPoint(pt);
                setEndInputText(`${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`);
                reverseGeocode(pt.lat, pt.lng, dockerStatus, activeEngine).then((g) => {
                  if (g.formattedAddress) setEndInputText(g.formattedAddress);
                });
              } else {
                const newId = `stop-${Date.now()}`;
                setStops((prev) => [...prev, { id: newId, point: pt, text: `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}` }]);
                reverseGeocode(pt.lat, pt.lng, dockerStatus, activeEngine).then((g) => {
                  if (g.formattedAddress) {
                    setStops((prev) => prev.map((s) => (s.id === newId ? { ...s, text: g.formattedAddress } : s)));
                  }
                });
              }
            }}
          >
            <Plus size={14} color="var(--gmaps-blue)" />
            <span>Add destination</span>
          </div>

          <div className="gmaps-context-divider" />

          {/* "What's here?" item */}
          <div
            className="gmaps-context-item"
            onClick={() => {
              const latlng = contextMenu.latlng;
              setContextMenu(null);
              setActivePlace({
                title: 'Loading address...',
                subtitle: `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`,
                lat: latlng.lat,
                lng: latlng.lng
              });
              reverseGeocode(latlng.lat, latlng.lng, dockerStatus, activeEngine).then((geo) => {
                setActivePlace({
                  title: geo.road || geo.city || 'Dropped Pin',
                  subtitle: geo.formattedAddress,
                  lat: latlng.lat,
                  lng: latlng.lng
                });
                if (geo.city) setCityName(geo.city);
              });
            }}
          >
            <span>📍 What&apos;s here?</span>
          </div>

          <div
            className="gmaps-context-item"
            onClick={() => {
              const coords = `${contextMenu.latlng.lat.toFixed(5)}, ${contextMenu.latlng.lng.toFixed(5)}`;
              navigator.clipboard.writeText(coords);
              showToast(`Copied ${coords} to clipboard`);
              setContextMenu(null);
            }}
          >
            <Copy size={14} />
            <span>Copy coordinates</span>
          </div>

          <div className="gmaps-context-divider" />

          <div
            className="gmaps-context-item"
            onClick={() => {
              mapInstanceRef.current?.panTo(contextMenu.latlng);
              setContextMenu(null);
            }}
          >
            <span>Center map here</span>
          </div>
        </div>
      )}

      {/* ====================================================================
          COLLAPSIBLE GEOOPS TOOLS & ROAD EDITOR DRAWER
          ==================================================================== */}
      {isToolsOpen && (
        <div
          className="gmaps-card animate-fade-in"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            zIndex: 1000,
            width: '320px',
            maxHeight: 'calc(100vh - 40px)',
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Wrench size={16} color="var(--gmaps-blue)" />
              <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.5px' }}>GEOOPS ENGINE & TOOLS</span>
            </div>
            <button
              className="gmaps-icon-btn"
              style={{ width: '28px', height: '28px' }}
              onClick={() => setIsToolsOpen(false)}
            >
              <X size={16} />
            </button>
          </div>

          {/* Jump to State Dropdown */}
          {currentProfileStates.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--gmaps-subtext)', fontWeight: 600 }}>JUMP TO MAP REGION</span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <select
                  value={selectedState}
                  onChange={(e) => {
                    const st = e.target.value;
                    setSelectedState(st);
                    const boundsData = (stateBounds as any)[st];
                    if (boundsData) {
                      setRouteBounds(L.latLngBounds([
                        [boundsData[0][0], boundsData[0][1]],
                        [boundsData[1][0], boundsData[1][1]]
                      ]));
                    }
                  }}
                  style={{
                    flex: 1,
                    background: 'var(--gmaps-bg)',
                    color: 'var(--gmaps-text)',
                    border: '1px solid var(--gmaps-border)',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    fontSize: '12px'
                  }}
                >
                  {currentProfileStates.map((st: string) => (
                    <option key={st} value={st}>
                      {st.charAt(0).toUpperCase() + st.slice(1).replace('-', ' ')}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const boundsData = (stateBounds as any)[selectedState];
                    if (boundsData) {
                      setRouteBounds(L.latLngBounds([
                        [boundsData[0][0], boundsData[0][1]],
                        [boundsData[1][0], boundsData[1][1]]
                      ]));
                    }
                  }}
                  style={{
                    background: 'var(--gmaps-blue)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Go
                </button>
              </div>
            </div>
          )}

          {/* Engine Selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--gmaps-subtext)', fontWeight: 600 }}>ROUTING & GEOCODING ENGINE</span>
              <span style={{ fontSize: '10px', color: activeEngine === 'osrm' ? 'var(--gmaps-blue)' : '#a78bfa', fontWeight: 600 }}>
                {activeEngine === 'osrm' ? 'Routing & Road Edits' : 'Geocoding Only'}
              </span>
            </div>
            <div style={{ display: 'flex', background: 'var(--gmaps-hover)', borderRadius: '6px', padding: '3px', border: '1px solid var(--gmaps-border)' }}>
              {(['osrm', 'nominatim', 'pelias'] as const).map((eng) => (
                <button
                  key={eng}
                  onClick={() => setActiveEngine(eng)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    border: 'none',
                    borderRadius: '4px',
                    background: activeEngine === eng ? 'var(--gmaps-blue)' : 'transparent',
                    color: activeEngine === eng ? '#ffffff' : 'var(--gmaps-subtext)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'uppercase'
                  }}
                >
                  {eng}
                </button>
              ))}
            </div>
          </div>

          {/* Road Editor Section: Road edits only work for OSRM */}
          {activeEngine !== 'osrm' ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--gmaps-border)',
                background: 'var(--gmaps-hover)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gmaps-subtext)' }}>ROAD EDITOR</span>
                <span style={{ fontSize: '10px', background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  OSRM Only
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--gmaps-subtext)', lineHeight: '1.4' }}>
                Road edits (speed limits & closures) only work for the <strong>OSRM</strong> routing engine. {activeEngine === 'nominatim' ? 'Nominatim' : 'Pelias'} is a geocoding engine for address search and place lookups.
              </div>
              <button
                onClick={() => setActiveEngine('osrm')}
                style={{
                  background: 'var(--gmaps-blue)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                Switch to OSRM to Edit Roads
              </button>
            </div>
          ) : routeCoordinates.length > 0 && profile === 'car' && isSameRoad ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--gmaps-border)',
                background: 'var(--gmaps-hover)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gmaps-green)' }}>ROAD EDITOR</span>
                  <span style={{ fontSize: '9px', background: 'rgba(24,128,56,0.15)', color: 'var(--gmaps-green)', padding: '1px 5px', borderRadius: '3px', fontWeight: 700 }}>
                    OSRM
                  </span>
                </div>
                <span style={{ fontSize: '11px', color: 'var(--gmaps-subtext)' }}>{roadName || 'Selected Segment'}</span>
              </div>

              {/* Bidirectional Mode */}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  onClick={() => setIsBidirectional(true)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    borderRadius: '4px',
                    border: 'none',
                    background: isBidirectional ? 'var(--gmaps-blue)' : 'transparent',
                    color: isBidirectional ? '#ffffff' : 'var(--gmaps-subtext)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Both Ways
                </button>
                <button
                  onClick={() => setIsBidirectional(false)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    borderRadius: '4px',
                    border: 'none',
                    background: !isBidirectional ? 'var(--gmaps-blue)' : 'transparent',
                    color: !isBidirectional ? '#ffffff' : 'var(--gmaps-subtext)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Independent
                </button>
              </div>

              {/* Forward Speed Limit & Status */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {!isBidirectional && <span style={{ fontSize: '11px', fontWeight: 600 }}>Direction A &rarr; B:</span>}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: 'var(--gmaps-subtext)' }}>Speed Limit:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="number"
                      value={newSpeed}
                      onChange={(e) => setNewSpeed(Number(e.target.value))}
                      disabled={isClosing}
                      style={{
                        width: '45px',
                        background: 'var(--gmaps-bg)',
                        border: '1px solid var(--gmaps-border)',
                        borderRadius: '4px',
                        color: 'var(--gmaps-text)',
                        textAlign: 'center',
                        padding: '4px',
                        fontSize: '12px',
                        fontWeight: 600
                      }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--gmaps-subtext)' }}>mph</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => setIsClosing(false)}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: '4px',
                      border: 'none',
                      background: !isClosing ? '#188038' : 'var(--gmaps-border)',
                      color: '#ffffff',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => setIsClosing(true)}
                    style={{
                      flex: 1,
                      padding: '6px',
                      borderRadius: '4px',
                      border: 'none',
                      background: isClosing ? '#ea4335' : 'var(--gmaps-border)',
                      color: '#ffffff',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Closed
                  </button>
                </div>
              </div>

              {/* Backward Direction (when Independent) */}
              {!isBidirectional && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '6px', borderTop: '1px solid var(--gmaps-border)' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600 }}>Direction B &rarr; A:</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', color: 'var(--gmaps-subtext)' }}>Speed Limit:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="number"
                        value={backSpeed}
                        onChange={(e) => setBackSpeed(Number(e.target.value))}
                        disabled={isBackClosing}
                        style={{
                          width: '45px',
                          background: 'var(--gmaps-bg)',
                          border: '1px solid var(--gmaps-border)',
                          borderRadius: '4px',
                          color: 'var(--gmaps-text)',
                          textAlign: 'center',
                          padding: '4px',
                          fontSize: '12px',
                          fontWeight: 600
                        }}
                      />
                      <span style={{ fontSize: '11px', color: 'var(--gmaps-subtext)' }}>mph</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => setIsBackClosing(false)}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '4px',
                        border: 'none',
                        background: !isBackClosing ? '#188038' : 'var(--gmaps-border)',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Open
                    </button>
                    <button
                      onClick={() => setIsBackClosing(true)}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '4px',
                        border: 'none',
                        background: isBackClosing ? '#ea4335' : 'var(--gmaps-border)',
                        color: '#ffffff',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Closed
                    </button>
                  </div>
                </div>
              )}

              {/* City and Street Name */}
              <input
                type="text"
                placeholder="City Name"
                value={cityName}
                onChange={(e) => setCityName(e.target.value)}
                style={{
                  background: 'var(--gmaps-bg)',
                  border: '1px solid var(--gmaps-border)',
                  borderRadius: '4px',
                  color: 'var(--gmaps-text)',
                  padding: '6px 8px',
                  fontSize: '12px'
                }}
              />

              <input
                type="text"
                placeholder="Street Name"
                value={roadName}
                onChange={(e) => setRoadName(e.target.value)}
                style={{
                  background: 'var(--gmaps-bg)',
                  border: '1px solid var(--gmaps-border)',
                  borderRadius: '4px',
                  color: 'var(--gmaps-text)',
                  padding: '6px 8px',
                  fontSize: '12px'
                }}
              />

              <textarea
                placeholder="Reason for road modification..."
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                rows={2}
                style={{
                  background: 'var(--gmaps-bg)',
                  border: '1px solid var(--gmaps-border)',
                  borderRadius: '4px',
                  color: 'var(--gmaps-text)',
                  padding: '6px 8px',
                  fontSize: '12px',
                  resize: 'none'
                }}
              />

              <button
                disabled={role === 'guest'}
                onClick={applyRoadEdit}
                style={{
                  background: '#188038',
                  color: '#ffffff',
                  border: 'none',
                  padding: '10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: role === 'guest' ? 'not-allowed' : 'pointer',
                  opacity: role === 'guest' ? 0.6 : 1
                }}
              >
                Apply Road Edit
              </button>
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--gmaps-subtext)', textAlign: 'center', padding: '12px 0', lineHeight: '1.4' }}>
              Select a single road route in Driving (OSRM) mode to modify road speeds or closures.
            </div>
          )}
        </div>
      )}

      {/* ====================================================================
          RAW JSON DEBUG MODAL
          ==================================================================== */}
      {showRawJson && rawJson && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.5)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)'
          }}
        >
          <div
            className="gmaps-card custom-scrollbar"
            style={{
              width: '80%',
              height: '80%',
              overflow: 'auto',
              padding: '24px',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <button
              onClick={() => setShowRawJson(false)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: '#ea4335',
                border: 'none',
                color: '#ffffff',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600
              }}
            >
              Close
            </button>

            <h3 style={{ margin: '0 0 16px 0', color: 'var(--gmaps-text)' }}>OSRM Request & Response</h3>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gmaps-subtext)' }}>Request URL:</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(rawRequestUrl);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 2000);
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--gmaps-border)',
                  color: 'var(--gmaps-text)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px'
                }}
              >
                {copiedUrl ? <Check size={12} color="#188038" /> : <Copy size={12} />}
                {copiedUrl ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div
              style={{
                fontSize: '11px',
                background: 'var(--gmaps-hover)',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid var(--gmaps-border)',
                marginBottom: '16px',
                wordBreak: 'break-all'
              }}
            >
              {rawRequestUrl}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gmaps-subtext)' }}>Response JSON:</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(rawJson, null, 2));
                  setCopiedJson(true);
                  setTimeout(() => setCopiedJson(false), 2000);
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--gmaps-border)',
                  color: 'var(--gmaps-text)',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px'
                }}
              >
                {copiedJson ? <Check size={12} color="#188038" /> : <Copy size={12} />}
                {copiedJson ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre
              style={{
                flex: 1,
                fontSize: '11px',
                background: 'var(--gmaps-hover)',
                padding: '14px',
                borderRadius: '6px',
                border: '1px solid var(--gmaps-border)',
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              {JSON.stringify(rawJson, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
