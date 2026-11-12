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
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

MPH_TO_KMH = 1.609344
KNOTS_TO_KMH = 1.852

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


def _route_road_keys(route: dict) -> set:
    """Union of normalized road names/refs across all non-arrive steps of a route."""
    keys = set()
    for leg in route.get('legs') or []:
        for s in leg.get('steps') or []:
            keys |= _step_road_keys(s)
    return keys


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


def enrich_osrm_response(
    data: dict,
    db_path: str,
    keep_nodes: bool = True,
    keep_had_annotations: bool = True,
    keep_steps: bool = True,
    nearest_fetcher=None,
) -> dict:
    """Adds `max_speed: {mph, kph}` onto each route in `data['routes']` that stays on a single road.

    Speeds come strictly from OSM `maxspeed` tags. If the route's own node pairs yield no tagged
    segment (e.g. pickup == dropoff -> zero-length route with no traversed segment), the OSM
    segment each waypoint snapped to (via OSRM `/nearest`) is used instead.
    """
    routes = data.get('routes')
    if not routes:
        return data

    conn = None
    if db_path and os.path.exists(db_path):
        try:
            conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
        except Exception:
            conn = None

    row_cache = {}
    has_names = False
    if conn is not None:
        try:
            cols = {r[1] for r in conn.execute('PRAGMA table_info(vals)').fetchall()}
            has_names = {'name', 'ref'}.issubset(cols)
        except Exception:
            has_names = False

    def lookup(a, b):
        key = (a, b)
        if key not in row_cache:
            row_cache[key] = conn.execute(
                'SELECT v.kmh, v.mph, v.is_unlimited, v.raw '
                'FROM seg s JOIN vals v ON v.id = s.v '
                'WHERE s.a = ? AND s.b = ? LIMIT 1',
                key,
            ).fetchone()
        return row_cache[key]

    def _row_matches_road(name, ref, match_keys):
        if name and name.strip().lower() in match_keys:
            return True
        for token in re.split(r'[;/,]', ref or ''):
            if token.strip().lower() and token.strip().lower() in match_keys:
                return True
        return False

    def lookup_touching(nodes, match_keys):
        """Rows for OSM segments starting at any of `nodes`, restricted to the route's road.

        Used when `/nearest` only yields one node (one-way roads) or the node pair is not adjacent.
        """
        cols = 'v.kmh, v.mph, v.is_unlimited, v.raw' + (', v.name, v.ref' if has_names else '')
        rows = []
        for n in nodes:
            rows.extend(conn.execute(
                f'SELECT {cols} FROM seg s JOIN vals v ON v.id = s.v WHERE s.a = ?', (n,)
            ).fetchall())
        if not rows:
            return []
        if has_names and match_keys:
            named = [r for r in rows if _row_matches_road(r[4], r[5], match_keys)]
            if named:
                return [r[:4] for r in named]
            # Intersection node shared with differently named roads only -> never borrow their speed.
            rows = [r for r in rows if not (r[4] or r[5])]
            if not rows:
                return []
        # Without names, only accept an unambiguous result (all touching segments share the same OSM limit).
        distinct = {(r[0], r[1], r[2]) for r in rows}
        return [rows[0][:4]] if len(distinct) == 1 else []

    try:
        for route in routes:
            # Avoid re-processing if already enriched upstream
            if 'max_speed' not in route and is_same_road_route(route):
                state = {'kph': None, 'mph': None, 'unlimited': False, 'found': False}

                def accumulate(row):
                    if not row:
                        return
                    kmh_val, mph_val, is_unlim, _raw = row
                    if is_unlim:
                        state['unlimited'] = True
                        state['found'] = True
                    elif kmh_val is not None and mph_val is not None:
                        state['found'] = True
                        if state['kph'] is None or kmh_val > state['kph']:
                            state['kph'] = float(kmh_val)
                            state['mph'] = float(mph_val)

                if conn is not None:
                    # 1. Segments actually traversed by the route
                    for leg in route.get('legs') or []:
                        nodes = ((leg.get('annotation') or {}).get('nodes')) or []
                        for i in range(len(nodes) - 1):
                            accumulate(lookup(nodes[i], nodes[i + 1]))

                    # 2. Fallback: OSM segment the waypoints snapped to (pickup == dropoff, very short routes)
                    if not state['found'] and nearest_fetcher is not None:
                        road_keys = _route_road_keys(route)
                        for wp in data.get('waypoints') or []:
                            if state['found']:
                                break
                            loc = wp.get('location')
                            if not loc or len(loc) < 2:
                                continue
                            wp_name = (wp.get('name') or '').strip().lower()
                            match_keys = set(road_keys)
                            if wp_name:
                                match_keys.add(wp_name)
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
                                    row = lookup(a, b) or lookup(b, a)
                                    if row:
                                        rows = [row]
                                if not rows:
                                    rows = lookup_touching(cand_nodes, match_keys)
                                for row in rows:
                                    accumulate(row)
                                if state['found']:
                                    break

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
