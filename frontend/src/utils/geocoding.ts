// Geocoding and reverse geocoding utility strictly restricted to local Pelias / Nominatim instances.
// Automatic telemetry reporting to backend API call statistics.
// All external/third-party public geocoding APIs (Photon, OSM public Nominatim, BigDataCloud) are disabled.

export interface PlaceResult {
  id: string;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  type?: string;
}

export interface ReverseGeocodeResult {
  formattedAddress: string;
  road?: string;
  city?: string;
  state?: string;
}

/**
 * Record an API hit to the backend statistics store so that the
 * Engine Setup dashboard metrics (hits, breakdown, response time) update in real-time.
 */
export async function recordApiCall(call: {
  profile: 'nominatim' | 'pelias' | 'car' | 'foot';
  service: string;
  latency: string;
  path: string;
  status?: number;
}) {
  try {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    await fetch('/api/system/api-calls/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: call.profile,
        service: call.service,
        latency: call.latency,
        path: call.path,
        status: call.status ?? 200,
        timestamp
      })
    });
  } catch {
    // Fail silently so network drops never block the application
  }
}

/**
 * Searches places/addresses strictly using installed local Pelias or Nominatim instances.
 * If neither is available or no local results match, returns empty list without calling any external APIs.
 */
export async function searchPlaces(
  query: string,
  options?: {
    dockerStatus?: any;
    activeEngine?: 'osrm' | 'nominatim' | 'pelias';
  }
): Promise<PlaceResult[]> {
  const clean = query.trim();
  if (!clean) return [];

  // Check if user entered coordinates directly (e.g. "39.29088, -76.61075")
  const coordMatch = clean.match(/^([-+]?\d{1,2}(?:\.\d+)?),\s*([-+]?\d{1,3}(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [{
        id: `coord-${lat}-${lng}`,
        title: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        subtitle: 'Coordinates',
        lat,
        lng,
        type: 'coordinate'
      }];
    }
  }

  const hostname = window.location.hostname || 'localhost';
  const activeEngine = options?.activeEngine || 'osrm';
  const docker = options?.dockerStatus;

  const isPeliasAvailable = docker?.pelias === 'running' || docker?.pelias_port;
  const isNominatimAvailable = docker?.nominatim === 'running' || docker?.nominatim_port;

  // Helper to query local Nominatim
  const tryLocalNominatim = async (): Promise<PlaceResult[] | null> => {
    if (!isNominatimAvailable) return null;
    const port = docker?.nominatim_port || 8080;
    const t0 = performance.now();
    try {
      const res = await fetch(`http://${hostname}:${port}/search?q=${encodeURIComponent(clean)}&format=json&addressdetails=1&limit=8`, { signal: AbortSignal.timeout(2500) });
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'nominatim', service: 'search', latency, path: clean, status: res.status });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.map((item: any, idx: number) => {
            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);
            const title = item.name || item.display_name.split(',')[0];
            const subtitle = item.display_name;
            return {
              id: item.place_id ? String(item.place_id) : `nom-${idx}`,
              title,
              subtitle,
              lat,
              lng,
              type: item.type || item.class
            };
          });
        }
      }
    } catch {
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'nominatim', service: 'search', latency, path: clean, status: 500 });
    }
    return null;
  };

  // Helper to query local Pelias
  const tryLocalPelias = async (): Promise<PlaceResult[] | null> => {
    if (!isPeliasAvailable) return null;
    const port = docker?.pelias_port || 4000;
    const t0 = performance.now();
    try {
      // 1. Try autocomplete first (ideal for prefix/typeahead search)
      let res = await fetch(`http://${hostname}:${port}/v1/autocomplete?text=${encodeURIComponent(clean)}&size=8`, { signal: AbortSignal.timeout(2000) });
      let data = res.ok ? await res.json() : null;

      // 2. If autocomplete returned no features, try full search endpoint
      if (!data?.features || data.features.length === 0) {
        res = await fetch(`http://${hostname}:${port}/v1/search?text=${encodeURIComponent(clean)}&size=8`, { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
          data = await res.json();
        }
      }

      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'pelias', service: 'search', latency, path: clean, status: res.status });

      if (data?.features?.length > 0) {
        return data.features.map((f: any, idx: number) => {
          const props = f.properties || {};
          const title = props.name || props.label?.split(',')[0] || clean;
          const subtitle = props.label || [props.locality, props.region].filter(Boolean).join(', ') || 'Local Pelias Result';
          return {
            id: props.id || props.gid || `pelias-${idx}`,
            title,
            subtitle,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
            type: props.layer
          };
        });
      }
    } catch {
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'pelias', service: 'search', latency, path: clean, status: 500 });
    }
    return null;
  };

  // Route to the appropriate installed engine
  if (activeEngine === 'nominatim') {
    const nomRes = await tryLocalNominatim();
    if (nomRes && nomRes.length > 0) return nomRes;
    const pelRes = await tryLocalPelias();
    if (pelRes && pelRes.length > 0) return pelRes;
  } else if (activeEngine === 'pelias') {
    const pelRes = await tryLocalPelias();
    if (pelRes && pelRes.length > 0) return pelRes;
    const nomRes = await tryLocalNominatim();
    if (nomRes && nomRes.length > 0) return nomRes;
  } else {
    // Default 'osrm' mode: utilize whichever local installed geocoders are running
    if (isPeliasAvailable) {
      const pelRes = await tryLocalPelias();
      if (pelRes && pelRes.length > 0) return pelRes;
    }
    if (isNominatimAvailable) {
      const nomRes = await tryLocalNominatim();
      if (nomRes && nomRes.length > 0) return nomRes;
    }
  }

  // Strictly NO external third-party fallbacks
  return [];
}

/**
 * Reverse geocodes coordinates strictly from installed local Pelias or Nominatim instances.
 * Strictly avoids any external public web APIs.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  dockerStatus?: any,
  activeEngine?: 'osrm' | 'nominatim' | 'pelias'
): Promise<ReverseGeocodeResult> {
  const hostname = window.location.hostname || 'localhost';

  const isPeliasAvailable = dockerStatus?.pelias === 'running' || dockerStatus?.pelias_port;
  const isNominatimAvailable = dockerStatus?.nominatim === 'running' || dockerStatus?.nominatim_port;

  // 1. Helper to reverse-geocode via local Pelias
  const tryPeliasReverse = async (): Promise<ReverseGeocodeResult | null> => {
    if (!isPeliasAvailable) return null;
    const pelPort = dockerStatus?.pelias_port || 4000;
    const t0 = performance.now();
    try {
      const res = await fetch(`http://${hostname}:${pelPort}/v1/reverse?point.lat=${lat}&point.lon=${lng}&size=1`, { signal: AbortSignal.timeout(2000) });
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'pelias', service: 'reverse', latency, path: `${lat.toFixed(5)},${lng.toFixed(5)}`, status: res.status });
      if (res.ok) {
        const data = await res.json();
        if (data?.features?.length > 0) {
          const props = data.features[0].properties || {};
          const road = props.street || props.name;
          const city = props.locality || props.county || props.region;
          const formattedAddress = props.label || [road, city, props.region].filter(Boolean).join(', ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          return {
            formattedAddress,
            road,
            city,
            state: props.region
          };
        }
      }
    } catch {
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'pelias', service: 'reverse', latency, path: `${lat.toFixed(5)},${lng.toFixed(5)}`, status: 500 });
    }
    return null;
  };

  // 2. Helper to reverse-geocode via local Nominatim
  const tryNominatimReverse = async (): Promise<ReverseGeocodeResult | null> => {
    if (!isNominatimAvailable) return null;
    const nomPort = dockerStatus?.nominatim_port || 8080;
    const t0 = performance.now();
    try {
      const res = await fetch(`http://${hostname}:${nomPort}/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`, { signal: AbortSignal.timeout(2000) });
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'nominatim', service: 'reverse', latency, path: `${lat.toFixed(5)},${lng.toFixed(5)}`, status: res.status });
      if (res.ok) {
        const data = await res.json();
        if (data?.display_name) {
          const addr = data.address || {};
          return {
            formattedAddress: data.display_name,
            road: addr.road || addr.street || addr.pedestrian || addr.highway,
            city: addr.city || addr.town || addr.village || addr.county,
            state: addr.state
          };
        }
      }
    } catch {
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'nominatim', service: 'reverse', latency, path: `${lat.toFixed(5)},${lng.toFixed(5)}`, status: 500 });
    }
    return null;
  };

  // Prioritize based on selected engine
  if (activeEngine === 'nominatim') {
    const nom = await tryNominatimReverse();
    if (nom) return nom;
    const pel = await tryPeliasReverse();
    if (pel) return pel;
  } else if (activeEngine === 'pelias') {
    const pel = await tryPeliasReverse();
    if (pel) return pel;
    const nom = await tryNominatimReverse();
    if (nom) return nom;
  } else {
    // In 'osrm' mode: try whichever local geocoder is running
    if (isPeliasAvailable) {
      const pel = await tryPeliasReverse();
      if (pel) return pel;
    }
    if (isNominatimAvailable) {
      const nom = await tryNominatimReverse();
      if (nom) return nom;
    }
  }

  // Strictly NO external APIs (no OSM public Nominatim, BigDataCloud, or Photon).
  // Return clean coordinate string as default fallback when not found in local index.
  return {
    formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  };
}
