// Geocoding and reverse geocoding utility supporting local Pelias / Nominatim
// with automatic telemetry reporting to backend API call statistics
// and resilient fallbacks to Photon, BigDataCloud, and OpenStreetMap Nominatim.

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
 * Searches places/addresses using local engine if configured or online,
 * and falls back to Photon & Nominatim.
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

  // Helper to query local Nominatim
  const tryLocalNominatim = async (): Promise<PlaceResult[] | null> => {
    const port = docker?.nominatim_port || 8080;
    const t0 = performance.now();
    try {
      const res = await fetch(`http://${hostname}:${port}/search?q=${encodeURIComponent(clean)}&format=json&addressdetails=1&limit=6`, { signal: AbortSignal.timeout(2000) });
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

  // Helper to query local Pelias autocomplete
  const tryLocalPelias = async (): Promise<PlaceResult[] | null> => {
    const port = docker?.pelias_port || 4000;
    const t0 = performance.now();
    try {
      const res = await fetch(`http://${hostname}:${port}/v1/autocomplete?text=${encodeURIComponent(clean)}&size=6`, { signal: AbortSignal.timeout(2000) });
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'pelias', service: 'autocomplete', latency, path: clean, status: res.status });
      if (res.ok) {
        const data = await res.json();
        if (data?.features?.length > 0) {
          return data.features.map((f: any, idx: number) => ({
            id: f.properties.id || `pelias-${idx}`,
            title: f.properties.name || f.properties.label,
            subtitle: f.properties.label || `${f.properties.locality || ''}, ${f.properties.region || ''}`,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
            type: f.properties.layer
          }));
        }
      }
    } catch {
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'pelias', service: 'autocomplete', latency, path: clean, status: 500 });
    }
    return null;
  };

  // 1. Order of trial based on activeEngine and container statuses
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
    // Default 'osrm' mode: utilize whichever local geocoders are online
    if (docker?.pelias === 'running' || docker?.pelias_port) {
      const pelRes = await tryLocalPelias();
      if (pelRes && pelRes.length > 0) return pelRes;
    }
    if (docker?.nominatim === 'running' || docker?.nominatim_port) {
      const nomRes = await tryLocalNominatim();
      if (nomRes && nomRes.length > 0) return nomRes;
    }
  }

  // 2. Photon Komoot open geocoding (fast, CORS-friendly, full address support)
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(clean)}&limit=6`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.features?.length > 0) {
        return data.features.map((f: any, idx: number) => {
          const props = f.properties || {};
          const title = props.name || [props.housenumber, props.street].filter(Boolean).join(' ') || clean;
          const subtitleParts = [
            props.street,
            props.city || props.town || props.village,
            props.state,
            props.country
          ].filter(Boolean);
          const subtitle = subtitleParts.join(', ') || props.country || 'Location';

          return {
            id: `${props.osm_type || 'f'}-${props.osm_id || idx}`,
            title,
            subtitle,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
            type: props.type || props.osm_key
          };
        });
      }
    }
  } catch {
    // Fallback to OSM Nominatim
  }

  // 3. OSM Nominatim fallback
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean)}&format=json&addressdetails=1&limit=6`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any, idx: number) => ({
          id: item.place_id ? String(item.place_id) : `nom-pub-${idx}`,
          title: item.name || item.display_name.split(',')[0],
          subtitle: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          type: item.type
        }));
      }
    }
  } catch {
    // Fallback failed
  }

  return [];
}

/**
 * Reverse geocodes coordinates to a human-readable address.
 * Resilient multi-provider strategy: local Nominatim -> local Pelias -> OSM Nominatim -> BigDataCloud -> Photon
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  dockerStatus?: any
): Promise<ReverseGeocodeResult> {
  const hostname = window.location.hostname || 'localhost';

  // 1. Try local Nominatim if running
  const nomPort = dockerStatus?.nominatim_port || 8080;
  if (dockerStatus?.nominatim === 'running' || dockerStatus?.nominatim_port) {
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
            road: addr.road || addr.street,
            city: addr.city || addr.town || addr.village || addr.county,
            state: addr.state
          };
        }
      }
    } catch {
      const latency = `${Math.round(performance.now() - t0)}ms`;
      recordApiCall({ profile: 'nominatim', service: 'reverse', latency, path: `${lat.toFixed(5)},${lng.toFixed(5)}`, status: 500 });
    }
  }

  // 2. Try local Pelias reverse if running
  const pelPort = dockerStatus?.pelias_port || 4000;
  if (dockerStatus?.pelias === 'running' || dockerStatus?.pelias_port) {
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
          return {
            formattedAddress: props.label || `${road || ''}, ${city || ''}`,
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
  }

  // 3. Try OSM Nominatim public reverse
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.display_name) {
        const addr = data.address || {};
        const road = addr.road || addr.street || addr.pedestrian || addr.highway;
        const city = addr.city || addr.town || addr.village || addr.suburb || addr.county;
        return {
          formattedAddress: data.display_name,
          road,
          city,
          state: addr.state
        };
      }
    }
  } catch {}

  // 4. Try BigDataCloud free client reverse geocoding API (fast, no CORS restriction)
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.locality || data?.city || data?.principalSubdivision) {
        const parts = [
          data.locality || data.city,
          data.principalSubdivision,
          data.countryName
        ].filter(Boolean);
        return {
          formattedAddress: parts.join(', '),
          road: data.locality,
          city: data.city || data.locality,
          state: data.principalSubdivision
        };
      }
    }
  } catch {}

  // 5. Try Photon reverse
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.features?.length > 0) {
        const props = data.features[0].properties || {};
        const road = props.street || props.name;
        const city = props.city || props.town || props.village;
        const parts = [road, city, props.state, props.country].filter(Boolean);
        return {
          formattedAddress: parts.join(', '),
          road,
          city,
          state: props.state
        };
      }
    }
  } catch {}

  // 6. Fallback to coordinate string
  return {
    formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  };
}
