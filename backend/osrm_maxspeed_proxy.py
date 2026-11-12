#!/usr/bin/env python3
"""Lightweight HTTP proxy for OSRM (car / foot) that enriches single-road route
responses with the road's legal OSM `maxspeed` in both `mph` and `kph`.

Uses only the Python 3 standard library so it can run inside `python:3.10-slim`
(or the RouteOps backend image) sharing the OSRM container's network namespace.
"""

import argparse
import json
import os
import re
import sqlite3
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

MPH_TO_KMH = 1.609344
KNOTS_TO_KMH = 1.852

# OSM road-type (`highway=*`) fallback speeds (MPH) used ONLY when a way has no explicit
# OSM `maxspeed` tag and no active Road Editor override.
HIGHWAY_DEFAULT_MPH = {
    'motorway': 65.0,
    'motorway_link': 35.0,
    'trunk': 55.0,
    'trunk_link': 35.0,
    'primary': 45.0,
    'primary_link': 30.0,
    'secondary': 35.0,
    'secondary_link': 30.0,
    'tertiary': 30.0,
    'tertiary_link': 25.0,
    'unclassified': 25.0,
    'residential': 25.0,
    'living_street': 15.0,
    'service': 15.0,
    'busway': 35.0,
    'road': 25.0,
    'track': 15.0,
    'cycleway': 15.0,
}

# Pedestrian-only OSM `highway=*` classes (KM/H) for walking paths/trails without `maxspeed`
HIGHWAY_PEDESTRIAN_KMH = {
    'footway': 5.0,
    'pedestrian': 5.0,
    'path': 5.0,
    'steps': 5.0,
    'corridor': 5.0,
    'bridleway': 5.0,
    'crossing': 5.0,
    'elevator': 5.0,
}

NON_ROUTABLE_HIGHWAYS = {
    'proposed',
    'construction',
    'abandoned',
    'razed',
    'disused',
    'demolished',
    'no',
    'platform',
    'rest_area',
    'services',
    'street_lamp',
    'traffic_signals',
    'stop',
    'give_way',
    'milestone',
    'speed_camera',
    'toll_gantry',
}

_HOP_BY_HOP_HEADERS = {
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'content-length',
    'access-control-allow-origin',
}


def parse_maxspeed(raw):
    """Parses an OSM `maxspeed` tag value strictly from OSM data (no hardcoded zone speeds).

    Returns `(kph, mph, is_unlimited)` where `kph` and `mph` are floats or `None`.
    """
    if raw is None:
        return None, None, False
    best_kph = None
    best_mph = None
    unlimited = False
    for part in re.split(r'[;|]', str(raw)):
        p = part.strip().lower()
        if not p:
            continue
        if p == 'none':
            unlimited = True
            continue
        m = re.match(r'^(\d+(?:\.\d+)?)\s*(mph|km/h|kmh|kph|knots)?$', p)
        if not m:
            continue
        val = float(m.group(1))
        unit = m.group(2)
        if unit == 'mph':
            mph = val
            kph = val * MPH_TO_KMH
        elif unit == 'knots':
            kph = val * KNOTS_TO_KMH
            mph = kph / MPH_TO_KMH
        else:
            kph = val
            mph = val / MPH_TO_KMH
        if best_kph is None or kph > best_kph:
            best_kph = kph
            best_mph = mph
    return best_kph, best_mph, unlimited


def highway_default_maxspeed(highway_raw):
    """Returns `(kph, mph, is_unlimited)` for an OSM `highway=*` road class when `maxspeed` is missing."""
    if not highway_raw:
        return None, None, False
    hw = str(highway_raw).strip().lower()
    if not hw or hw in NON_ROUTABLE_HIGHWAYS:
        return None, None, False
    if hw in HIGHWAY_DEFAULT_MPH:
        mph = HIGHWAY_DEFAULT_MPH[hw]
        return mph * MPH_TO_KMH, mph, False
    if hw in HIGHWAY_PEDESTRIAN_KMH:
        kph = HIGHWAY_PEDESTRIAN_KMH[hw]
        return kph, kph / MPH_TO_KMH, False
    if hw.endswith('_link'):
        mph = 30.0
        return mph * MPH_TO_KMH, mph, False
    mph = 25.0
    return mph * MPH_TO_KMH, mph, False


def infer_step_fallback_speed(route: dict):
    """Infers OSM road-type fallback `(kmh, mph, 0, raw, 1)` from OSRM step metadata when DB lacks an entry.

    Uses only static road/step classification (`mode`, `maneuver`, `classes`, `ref`, `name`) — never `duration` —
    so the result is invariant to pin spacing and `start == dropoff`. Returns None for non-road modes (e.g. ferry).
    """
    steps = []
    for leg in route.get('legs') or []:
        for s in leg.get('steps') or []:
            mtype = ((s.get('maneuver') or {}).get('type') or '').lower()
            if mtype != 'arrive':
                steps.append(s)
    if not steps:
        for leg in route.get('legs') or []:
            steps.extend(leg.get('steps') or [])
    if not steps:
        return None

    modes = {(s.get('mode') or '').strip().lower() for s in steps if s.get('mode')}
    if 'ferry' in modes or 'train' in modes:
        return None
    if modes and modes <= {'walking', 'pedestrian'}:
        kph = 5.0
        return (kph, kph / MPH_TO_KMH, 0, 'fallback:footway', 1)
    if modes and modes <= {'cycling', 'pushing bike'}:
        mph = 15.0
        return (mph * MPH_TO_KMH, mph, 0, 'fallback:cycleway', 1)

    classes = set()
    maneuvers = set()
    names = set()
    refs = []
    for s in steps:
        mtype = ((s.get('maneuver') or {}).get('type') or '').strip().lower()
        if mtype:
            maneuvers.add(mtype)
        nm = (s.get('name') or '').strip().lower()
        if nm and nm != 'unnamed':
            names.add(nm)
        rf = (s.get('ref') or '').strip()
        if rf:
            for tok in re.split(r'[;/,]', rf):
                if tok.strip():
                    refs.append(tok.strip().upper())
        for inter in s.get('intersections') or []:
            for cls in inter.get('classes') or []:
                classes.add(str(cls).strip().lower())

    if maneuvers & {'on ramp', 'off ramp', 'ramp'}:
        mph = HIGHWAY_DEFAULT_MPH['motorway_link']
        return (mph * MPH_TO_KMH, mph, 0, 'fallback:motorway_link', 1)

    has_interstate_ref = any(re.match(r'^I[\s\-]?\d+', r) for r in refs)
    if 'motorway' in classes or has_interstate_ref:
        mph = HIGHWAY_DEFAULT_MPH['motorway'] if names else HIGHWAY_DEFAULT_MPH['motorway_link']
        return (mph * MPH_TO_KMH, mph, 0, 'fallback:motorway' if names else 'fallback:motorway_link', 1)

    if any(re.match(r'^US[\s\-]?\d+', r) for r in refs):
        mph = HIGHWAY_DEFAULT_MPH['primary'] if names else HIGHWAY_DEFAULT_MPH['trunk_link']
        return (mph * MPH_TO_KMH, mph, 0, 'fallback:primary', 1)

    if refs:
        mph = HIGHWAY_DEFAULT_MPH['secondary'] if names else HIGHWAY_DEFAULT_MPH['secondary_link']
        return (mph * MPH_TO_KMH, mph, 0, 'fallback:secondary', 1)

    if any(w in n for n in names for w in ('freeway', 'expressway', 'parkway', 'turnpike', 'thruway')):
        mph = HIGHWAY_DEFAULT_MPH['trunk']
        return (mph * MPH_TO_KMH, mph, 0, 'fallback:trunk', 1)

    if any(w in n for n in names for w in ('highway', 'boulevard', 'blvd')):
        mph = HIGHWAY_DEFAULT_MPH['secondary']
        return (mph * MPH_TO_KMH, mph, 0, 'fallback:secondary', 1)

    if any(w in n for n in names for w in ('alley', 'driveway', 'service')):
        mph = HIGHWAY_DEFAULT_MPH['service']
        return (mph * MPH_TO_KMH, mph, 0, 'fallback:service', 1)

    mph = HIGHWAY_DEFAULT_MPH['residential']
    return (mph * MPH_TO_KMH, mph, 0, 'fallback:residential', 1)


def _step_road_keys(step: dict) -> set:
    """Extracts normalized road name and route ref identifiers from an OSRM step."""
    keys = set()
    name = (step.get('name') or '').strip().lower()
    ref = (step.get('ref') or '').strip().lower()
    if name and name != 'unnamed':
        keys.add(name)
    if ref:
        for token in re.split(r'[;/,]', ref):
            token = token.strip()
            if token:
                keys.add(token)
    return keys


def is_same_road_route(route: dict) -> bool:
    """Returns True iff the entire OSRM route stays on the same road."""
    legs = route.get('legs') or []
    if not legs:
        return False

    driving_steps = []
    for leg in legs:
        steps = leg.get('steps')
        if not steps:
            return False
        for s in steps:
            mtype = ((s.get('maneuver') or {}).get('type') or '').lower()
            if mtype != 'arrive':
                driving_steps.append(s)

    if not driving_steps:
        return False
    if len(driving_steps) == 1 or (route.get('distance') or 0) == 0:
        return True

    step_key_sets = [_step_road_keys(s) for s in driving_steps]
    # A multi-step route with an unnamed/unref'd turn involves more than one road.
    if any(len(ks) == 0 for ks in step_key_sets):
        return False

    common = set(step_key_sets[0])
    for ks in step_key_sets[1:]:
        common &= ks
    if common:
        return True

    primary_labels = {
        ((s.get('name') or s.get('ref') or '').strip().lower())
        for s in driving_steps
    }
    primary_labels.discard('')
    primary_labels.discard('unnamed')
    return len(primary_labels) == 1


def prepare_upstream_query(raw_query: str, enrich: bool):
    """Ensures `annotations=nodes` and `steps=true` are requested upstream for route enrichment.

    Returns `(upstream_query, keep_nodes, keep_had_annotations, keep_steps)`.
    """
    parts = [p for p in (raw_query or '').split('&') if p]
    if not enrich:
        return '&'.join(parts), True, True, True

    keep_nodes = True
    keep_had_annotations = True
    keep_steps = True

    ann_idx = next((i for i, p in enumerate(parts) if p.split('=', 1)[0] == 'annotations'), None)
    if ann_idx is None:
        parts.append('annotations=nodes')
        keep_nodes = False
        keep_had_annotations = False
    else:
        val = unquote(parts[ann_idx].split('=', 1)[1]) if '=' in parts[ann_idx] else ''
        if val in ('', 'false'):
            parts[ann_idx] = 'annotations=nodes'
            keep_nodes = False
            keep_had_annotations = False
        elif val != 'true':
            values = [v for v in val.split(',') if v]
            if 'nodes' not in values:
                parts[ann_idx] = 'annotations=' + ','.join(values + ['nodes'])
                keep_nodes = False

    steps_idx = next((i for i, p in enumerate(parts) if p.split('=', 1)[0] == 'steps'), None)
    if steps_idx is None:
        parts.append('steps=true')
        keep_steps = False
    else:
        sval = unquote(parts[steps_idx].split('=', 1)[1]).lower() if '=' in parts[steps_idx] else ''
        if sval != 'true':
            parts[steps_idx] = 'steps=true'
            keep_steps = False

    return '&'.join(parts), keep_nodes, keep_had_annotations, keep_steps


def _route_road_names_and_refs(route: dict):
    """Returns `(names_set, refs_set)` across all steps of a route."""
    names = set()
    refs = set()
    for leg in route.get('legs') or []:
        for s in leg.get('steps') or []:
            nm = (s.get('name') or '').strip().lower()
            if nm and nm != 'unnamed':
                names.add(nm)
            rf = (s.get('ref') or '').strip().lower()
            if rf:
                for token in re.split(r'[;/,]', rf):
                    tok = token.strip()
                    if tok:
                        refs.add(tok)
    return names, refs


def make_nearest_fetcher(fetch_json, osrm_profile: str):
    """Builds a cached callable `(lon, lat) -> [{'nodes': [a, b], 'name': str}, ...]` backed by OSRM `/nearest`.

    `fetch_json(path_and_query)` must return the parsed JSON body of an upstream OSRM request (or None).
    """
    cache = {}

    def fetcher(lon, lat):
        key = (round(float(lon), 7), round(float(lat), 7))
        if key in cache:
            return cache[key]
        candidates = []
        try:
            res = fetch_json(f'/nearest/v1/{osrm_profile}/{key[0]:.7f},{key[1]:.7f}?number=3')
            if isinstance(res, dict) and res.get('code') == 'Ok':
                for wp in res.get('waypoints') or []:
                    # One-way roads report the disabled direction as 0 (e.g. [2264199819, 0]); keep the real node.
                    nodes = [n for n in (wp.get('nodes') or []) if isinstance(n, int) and n > 0]
                    if nodes:
                        candidates.append({'nodes': nodes[:2], 'name': (wp.get('name') or '').strip().lower()})
        except Exception:
            candidates = []
        cache[key] = candidates
        return candidates

    return fetcher


_OVERRIDES_LOCK = threading.Lock()
_OVERRIDES_CACHE = {}


def _open_sqlite_ro(path: str):
    """Opens a SQLite database read-only safely across Linux and Windows paths (including spaces)."""
    try:
        uri = f'{Path(path).resolve().as_uri()}?mode=ro'
        return sqlite3.connect(uri, uri=True)
    except Exception:
        return sqlite3.connect(path)


def _stat_sig(path: str):
    try:
        st = os.stat(path)
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def _build_override_maps(records: list):
    """Builds `(pairs, touching)` from ordered override dicts/rows (`id ASC`, latest wins)."""
    pairs = {}
    touching_by_edge = {}

    def add_edge(a_raw, b_raw, kmh_val: float, road_name_norm: str):
        a_str = str(a_raw or '').strip()
        b_str = str(b_raw or '').strip()
        if not (a_str.isdigit() and b_str.isdigit()):
            return
        a_id, b_id = int(a_str), int(b_str)
        if a_id == b_id:
            return
        mph_val = kmh_val / MPH_TO_KMH
        # Tier 3 = active Road Editor override (highest priority)
        pairs[(a_id, b_id)] = (kmh_val, mph_val, 0, 'override', 3)
        touching_by_edge[(a_id, b_id)] = (kmh_val, mph_val, 0, 'override', 3, road_name_norm, '')

    for rec in records:
        if bool(rec.get('is_closed')):
            continue
        try:
            kmh = float(rec.get('speed_kmh') or 0)
        except (TypeError, ValueError):
            continue
        if kmh <= 0:
            continue
        from_raw = str(rec.get('from_node') or '').strip()
        to_raw = str(rec.get('to_node') or '').strip()
        bidir = bool(rec.get('is_bidirectional'))
        rname = str(rec.get('road_name') or '').strip().lower()
        if ',' in from_raw:
            ns = [s.strip() for s in from_raw.split(',') if s.strip()]
            for i in range(len(ns) - 1):
                add_edge(ns[i], ns[i + 1], kmh, rname)
                if bidir:
                    add_edge(ns[i + 1], ns[i], kmh, rname)
        elif from_raw and to_raw:
            add_edge(from_raw, to_raw, kmh, rname)
            if bidir:
                add_edge(to_raw, from_raw, kmh, rname)

    touching = {}
    for (a_id, b_id), row in touching_by_edge.items():
        touching.setdefault(a_id, []).append(row)
        touching.setdefault(b_id, []).append(row)
    return pairs, touching


def _load_speed_overrides(data_dir: str):
    """Loads active non-closed speed overrides from `speed_overrides.json` or `osrm_portal.db` (mtime-cached)."""
    if not data_dir or not os.path.isdir(data_dir):
        return {}, {}

    json_path = os.path.join(data_dir, 'speed_overrides.json')
    db_candidates = [
        os.path.join(data_dir, 'osrm_portal.db'),
        os.path.abspath(os.path.join(data_dir, '..', 'backend', 'osrm_portal.db')),
    ]
    db_file = next((p for p in db_candidates if os.path.exists(p)), None)

    json_sig = _stat_sig(json_path)
    db_sig = _stat_sig(db_file) if db_file else None
    wal_sig = _stat_sig(f'{db_file}-wal') if db_file else None
    sig = (json_sig, db_file, db_sig, wal_sig)

    with _OVERRIDES_LOCK:
        cached = _OVERRIDES_CACHE.get(data_dir)
        if cached and cached[0] == sig:
            return cached[1], cached[2]

    records = None
    use_json = json_sig is not None and (
        db_sig is None or json_sig[0] >= max(db_sig[0], wal_sig[0] if wal_sig else 0)
    )
    if use_json:
        try:
            with open(json_path, 'r', encoding='utf-8') as jf:
                loaded = json.load(jf)
            if isinstance(loaded, list):
                records = loaded
        except Exception:
            records = None

    if records is None and db_file:
        ov_conn = None
        try:
            ov_conn = _open_sqlite_ro(db_file)
            cur = ov_conn.execute(
                'SELECT from_node, to_node, speed_kmh, is_closed, is_bidirectional, road_name '
                'FROM road_overrides ORDER BY id ASC'
            )
            records = [
                {
                    'from_node': r[0],
                    'to_node': r[1],
                    'speed_kmh': r[2],
                    'is_closed': r[3],
                    'is_bidirectional': r[4],
                    'road_name': r[5],
                }
                for r in cur.fetchall()
            ]
        except Exception:
            records = []
        finally:
            if ov_conn is not None:
                ov_conn.close()

    pairs, touching = _build_override_maps(records or [])
    with _OVERRIDES_LOCK:
        _OVERRIDES_CACHE[data_dir] = (sig, pairs, touching)
    return pairs, touching


def enrich_osrm_response(
    data: dict,
    db_path: str,
    keep_nodes: bool = True,
    keep_had_annotations: bool = True,
    keep_steps: bool = True,
    nearest_fetcher=None,
) -> dict:
    """Adds `max_speed: {mph, kph}` onto each route in `data['routes']` that stays on a single road.

    Speeds come strictly from OSM `maxspeed` tags (with any active user speed override applied on top).
    If the route's own node pairs yield no tagged segment (e.g. pickup == dropoff -> zero-length route
    with no traversed segment), the road segment each waypoint snapped to (via OSRM `/nearest`) is used.
    """
    routes = data.get('routes')
    if not routes:
        return data

    ov_pairs, ov_touching = _load_speed_overrides(os.path.dirname(db_path) if db_path else '')

    conn = None
    if db_path and os.path.exists(db_path):
        try:
            conn = _open_sqlite_ro(db_path)
        except Exception:
            conn = None

    row_cache = {}
    has_names = False
    has_fallback_col = False
    has_seg_b = False
    if conn is not None:
        try:
            cols = {r[1] for r in conn.execute('PRAGMA table_info(vals)').fetchall()}
            has_names = {'name', 'ref'}.issubset(cols)
            has_fallback_col = 'is_fallback' in cols
            idx_names = {r[1] for r in conn.execute('PRAGMA index_list(seg)').fetchall()}
            has_seg_b = 'seg_b' in idx_names
        except Exception:
            has_names = False
            has_fallback_col = False
            has_seg_b = False

    def lookup(a, b):
        if conn is None:
            return None
        key = (a, b)
        if key not in row_cache:
            if has_fallback_col:
                r = conn.execute(
                    'SELECT v.kmh, v.mph, v.is_unlimited, v.raw, v.is_fallback '
                    'FROM seg s JOIN vals v ON v.id = s.v '
                    'WHERE s.a = ? AND s.b = ? '
                    'ORDER BY v.is_fallback ASC, v.kmh DESC LIMIT 1',
                    key,
                ).fetchone()
                row_cache[key] = (r[0], r[1], r[2], r[3], 1 if r[4] else 2) if r else None
            else:
                r = conn.execute(
                    'SELECT v.kmh, v.mph, v.is_unlimited, v.raw '
                    'FROM seg s JOIN vals v ON v.id = s.v '
                    'WHERE s.a = ? AND s.b = ? LIMIT 1',
                    key,
                ).fetchone()
                row_cache[key] = (r[0], r[1], r[2], r[3], 2) if r else None
        return row_cache[key]

    def _ref_matches(ref_val: str, target_keys: set) -> bool:
        for token in re.split(r'[;/,]', ref_val or ''):
            tok = token.strip().lower()
            if tok and tok in target_keys:
                return True
        return False

    def _filter_touching_rows(rows, route_names: set, route_refs: set, named_schema: bool):
        if not rows:
            return []
        if named_schema:
            all_keys = route_names | route_refs
            if route_names:
                by_name = [r for r in rows if (r[5] or '').strip().lower() in route_names]
                if by_name:
                    return [r[:5] for r in by_name]
                by_any = [
                    r for r in rows
                    if (r[5] or '').strip().lower() in all_keys or _ref_matches(r[6], all_keys)
                ]
                return [r[:5] for r in by_any] if by_any else []
            if route_refs:
                unnamed_ref = [
                    r for r in rows
                    if not (r[5] or '').strip() and _ref_matches(r[6], route_refs)
                ]
                if unnamed_ref:
                    return [r[:5] for r in unnamed_ref]
                any_ref = [
                    r for r in rows
                    if _ref_matches(r[6], route_refs) or (r[5] or '').strip().lower() in route_refs
                ]
                return [r[:5] for r in any_ref] if any_ref else []
            unnamed = [r for r in rows if not ((r[5] or '').strip() or (r[6] or '').strip())]
            return [r[:5] for r in unnamed] if unnamed else []

        distinct = {(r[0], r[1], r[2]) for r in rows}
        return [rows[0][:5]] if len(distinct) == 1 else []

    def lookup_override_touching(nodes, route_names: set, route_refs: set):
        if not ov_touching:
            return []
        rows = []
        for n in nodes:
            rows.extend(ov_touching.get(n) or [])
        return _filter_touching_rows(rows, route_names, route_refs, named_schema=True)

    def lookup_touching(nodes, route_names: set, route_refs: set):
        """Rows for OSM segments touching `nodes`, restricted to the route's road.

        Used when `/nearest` only yields one node (one-way roads) or the node pair is not adjacent.
        """
        if conn is None:
            return []
        tier_expr = 'CASE WHEN v.is_fallback != 0 THEN 1 ELSE 2 END' if has_fallback_col else '2'
        name_expr = 'v.name, v.ref' if has_names else "'' AS name, '' AS ref"
        sql_cols = f'v.kmh, v.mph, v.is_unlimited, v.raw, {tier_expr}, {name_expr}'
        rows = []
        for n in nodes:
            rows.extend(conn.execute(
                f'SELECT {sql_cols} FROM seg s JOIN vals v ON v.id = s.v WHERE s.a = ?', (n,)
            ).fetchall())
            if has_seg_b:
                rows.extend(conn.execute(
                    f'SELECT {sql_cols} FROM seg s JOIN vals v ON v.id = s.v WHERE s.b = ?', (n,)
                ).fetchall())
        return _filter_touching_rows(rows, route_names, route_refs, named_schema=has_names)

    try:
        for route in routes:
            # Avoid re-processing if already enriched upstream
            if 'max_speed' not in route and is_same_road_route(route):
                state = {'tier': 0, 'kph': None, 'mph': None, 'unlimited': False, 'found': False}

                def accumulate(row):
                    if not row:
                        return
                    kmh_val, mph_val, is_unlim, _raw, tier = row
                    if tier < state['tier']:
                        return
                    if not is_unlim and (kmh_val is None or mph_val is None):
                        return
                    if tier > state['tier']:
                        state['tier'] = tier
                        state['kph'] = None
                        state['mph'] = None
                        state['unlimited'] = False
                    if is_unlim:
                        state['unlimited'] = True
                        state['found'] = True
                    else:
                        state['found'] = True
                        if state['kph'] is None or float(kmh_val) > state['kph']:
                            state['kph'] = float(kmh_val)
                            state['mph'] = float(mph_val)

                if conn is not None or ov_pairs:
                    # 1. Segments actually traversed by the route
                    for leg in route.get('legs') or []:
                        nodes = ((leg.get('annotation') or {}).get('nodes')) or []
                        for i in range(len(nodes) - 1):
                            a_n, b_n = nodes[i], nodes[i + 1]
                            if not isinstance(a_n, int) or not isinstance(b_n, int) or a_n <= 0 or b_n <= 0 or a_n == b_n:
                                continue
                            accumulate(ov_pairs.get((a_n, b_n)) or lookup(a_n, b_n))

                    # 2. Snapped road segment via OSRM `/nearest` (pickup == dropoff / zero-length routes)
                    if not state['found'] and nearest_fetcher is not None:
                        base_names, base_refs = _route_road_names_and_refs(route)
                        for wp in data.get('waypoints') or []:
                            if state['found']:
                                break
                            loc = wp.get('location')
                            if not loc or len(loc) < 2:
                                continue
                            wp_name = (wp.get('name') or '').strip().lower()
                            route_names = set(base_names)
                            if wp_name and wp_name != 'unnamed':
                                route_names.add(wp_name)
                            route_refs = set(base_refs)
                            match_keys = route_names | route_refs
                            for idx, cand in enumerate(nearest_fetcher(loc[0], loc[1]) or []):
                                cand_name = cand.get('name') or ''
                                if match_keys:
                                    if cand_name and cand_name not in match_keys:
                                        continue
                                    if not cand_name and idx != 0:
                                        continue
                                elif idx != 0:
                                    continue
                                cand_nodes = cand.get('nodes') or []
                                rows = []
                                if len(cand_nodes) >= 2:
                                    a, b = cand_nodes[0], cand_nodes[1]
                                    ov_rows = [r for r in (ov_pairs.get((a, b)), ov_pairs.get((b, a))) if r is not None]
                                    if ov_rows:
                                        rows = ov_rows
                                    else:
                                        rows = [r for r in (lookup(a, b), lookup(b, a)) if r is not None]
                                if not rows:
                                    rows = (
                                        lookup_override_touching(cand_nodes, route_names, route_refs)
                                        or lookup_touching(cand_nodes, route_names, route_refs)
                                    )
                                for row in rows:
                                    accumulate(row)
                                if state['found']:
                                    break

                # 3. Road-type safety fallback when OSM index has not yet backfilled `highway=*` rows
                if not state['found']:
                    accumulate(infer_step_fallback_speed(route))

                if state['unlimited']:
                    route['max_speed'] = {'mph': None, 'kph': None, 'unlimited': True}
                elif state['kph'] is not None and state['mph'] is not None:
                    route['max_speed'] = {
                        'mph': round(state['mph'], 1),
                        'kph': round(state['kph'], 1),
                    }
                else:
                    route['max_speed'] = None

            # Restore original annotation/steps shape if caller did not request them
            for leg in route.get('legs') or []:
                if not keep_steps and 'steps' in leg:
                    leg['steps'] = []
                ann = leg.get('annotation')
                if isinstance(ann, dict):
                    if not keep_had_annotations:
                        leg.pop('annotation', None)
                    elif not keep_nodes:
                        ann.pop('nodes', None)
    finally:
        if conn is not None:
            conn.close()

    return data


def run_server(profile: str, listen_port: int, upstream_port: int, data_dir: str):
    db_path = os.path.join(data_dir, f'{profile}_maxspeed.sqlite')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    class ReusableThreadingHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True
        daemon_threads = True

    class OSRMMaxspeedProxyHandler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', '*')
            self.send_header('Content-Length', '0')
            self.end_headers()

        def do_HEAD(self):
            self._handle(head_only=True)

        def do_GET(self):
            self._handle(head_only=False)

        def _handle(self, head_only: bool):
            raw_path, _, raw_query = self.path.partition('?')
            seg = [s for s in raw_path.split('/') if s]
            service = seg[0] if seg else ''
            enrich = (service == 'route' and not head_only)

            up_query, keep_nodes, keep_had_ann, keep_steps = prepare_upstream_query(raw_query, enrich)
            up_url = f'http://127.0.0.1:{upstream_port}{raw_path}' + (f'?{up_query}' if up_query else '')

            try:
                req = urllib.request.Request(up_url, method='HEAD' if head_only else 'GET')
                with opener.open(req, timeout=60) as resp:
                    status = resp.status
                    up_headers = list(resp.headers.items())
                    body = b'' if head_only else resp.read()
            except urllib.error.HTTPError as he:
                status = he.code
                up_headers = list(he.headers.items()) if he.headers else []
                body = b'' if head_only else he.read()
            except Exception as exc:
                err_bytes = json.dumps({
                    'code': 'EngineUnavailable',
                    'message': f'Upstream osrm-routed ({profile}) unreachable: {exc}',
                }).encode('utf-8')
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(err_bytes)))
                self.end_headers()
                if not head_only:
                    self.wfile.write(err_bytes)
                return

            content_type = next((v for k, v in up_headers if k.lower() == 'content-type'), 'application/json')
            if enrich and status == 200 and 'json' in (content_type or '').lower() and body:
                try:
                    data = json.loads(body)
                    if data.get('code') == 'Ok':
                        osrm_profile = seg[2] if len(seg) > 2 else 'driving'

                        def fetch_json(path_and_query):
                            with opener.open(f'http://127.0.0.1:{upstream_port}{path_and_query}', timeout=10) as r:
                                return json.loads(r.read())

                        data = enrich_osrm_response(
                            data,
                            db_path=db_path,
                            keep_nodes=keep_nodes,
                            keep_had_annotations=keep_had_ann,
                            keep_steps=keep_steps,
                            nearest_fetcher=make_nearest_fetcher(fetch_json, osrm_profile),
                        )
                        body = json.dumps(data, separators=(',', ':')).encode('utf-8')
                except Exception:
                    pass

            self.send_response(status)
            for k, v in up_headers:
                if k.lower() not in _HOP_BY_HOP_HEADERS:
                    self.send_header(k, v)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if not head_only and body:
                self.wfile.write(body)

        def log_message(self, fmt, *args):
            # Upstream osrm-routed already logs each API request on the main container.
            return

    server = ReusableThreadingHTTPServer(('0.0.0.0', listen_port), OSRMMaxspeedProxyHandler)
    print(
        f'[MAXSPEED-PROXY] Serving {profile} on 0.0.0.0:{listen_port} -> 127.0.0.1:{upstream_port} (db={db_path})',
        flush=True,
    )
    server.serve_forever()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='OSRM Maxspeed HTTP Proxy')
    parser.add_argument('--profile', required=True, choices=['car', 'foot'])
    parser.add_argument('--listen', type=int, default=5000)
    parser.add_argument('--upstream', type=int, default=5050)
    parser.add_argument('--data-dir', default='/data')
    ns = parser.parse_args()
    run_server(ns.profile, ns.listen, ns.upstream, ns.data_dir)
