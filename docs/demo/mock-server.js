// ===== デモ版: ラズパイ(Flask)の API をブラウザ内で再現する =====
// fetch() を横取りし、/location などへのリクエストに擬似データで応答する。
// 計算は app.py / TreePlanting.py と同じ手順を GeographicLib (pyproj と同じ測地線計算) で行う。
(function () {
  'use strict';

  const geod = geodesic.Geodesic.WGS84;

  // 擬似GNSSの初期位置（実在の現場とは無関係な地点）
  const START = { lat: 36.0, lon: 138.0, alt: 850.0 };
  const ARRIVALS_KEY = 'gfs_demo_arrivals';

  const sim = {
    lat: START.lat,
    lon: START.lon,
    alt: START.alt,
    speed: 0,
    autoWalk: true,
    walkSpeed: 1.0,   // m/s
    lastTick: Date.now(),
  };

  // ---- 擬似歩行: 誘導中は次の目標ポイントへ向かって歩く ----
  function currentTarget() {
    try {
      if (currentScreen !== 8 || !watchInterval) return null;
      if (!Array.isArray(corners) || nextPointIndex >= corners.length) return null;
      return corners[nextPointIndex];
    } catch {
      return null;  // 本体スクリプトの読み込み前
    }
  }

  function tick() {
    const now = Date.now();
    const dt = Math.min((now - sim.lastTick) / 1000, 1.0);  // alert 中に止まった分は飛ばさない
    sim.lastTick = now;
    sim.speed = 0;

    const target = sim.autoWalk ? currentTarget() : null;
    if (!target) return;

    const inv = geod.Inverse(sim.lat, sim.lon, target[1], target[0]);
    const step = sim.walkSpeed * dt;
    if (inv.s12 <= step) {
      sim.lat = target[1];
      sim.lon = target[0];
    } else {
      const d = geod.Direct(sim.lat, sim.lon, inv.azi1, step);
      sim.lat = d.lat2;
      sim.lon = d.lon2;
    }
    sim.speed = sim.walkSpeed;
  }
  setInterval(tick, 100);

  function moveBy(azimuth, meters) {
    const d = geod.Direct(sim.lat, sim.lon, azimuth, meters);
    sim.lat = d.lat2;
    sim.lon = d.lon2;
  }

  // RTK Fix 相当の微小なばらつき（数mm）
  function noise(sigmaM) {
    const u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigmaM;
  }

  // ---- 計算処理（TreePlanting.py / BearingCalculation.py / DifferenceCalculation.py の移植）----
  function calculateBearing(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const p1 = lat1 * r, p2 = lat2 * r, dl = (lon2 - lon1) * r;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return ((Math.atan2(y, x) / r) + 360) % 360;
  }

  function calculateDifference(lat, lon, bearing, distance) {
    const d = geod.Direct(lat, lon, bearing, distance);
    return [d.lat2 - lat, d.lon2 - lon];
  }

  function treeGrid(height, width, spaceHeight, spaceWidth, skipOrigin) {
    const pts = [];
    for (let i = 0; i < width; i++) {
      for (let k = 0; k < height; k++) {
        const j = (i % 2 === 0) ? k : height - 1 - k;  // 列ごとに往復（蛇行順）
        const x = i * spaceWidth, y = j * spaceHeight;
        if (skipOrigin && x === 0 && y === 0) continue;
        pts.push([x, y]);
      }
    }
    return pts;
  }

  // 参照点モード: CP→参照点の方位で格子を回転し、1mあたりの緯度経度差で変換
  function treePlantingCoordinates(cpLat, cpLon, refLat, refLon, height, width, spaceHeight, spaceWidth) {
    const diff0 = calculateDifference(cpLat, cpLon, 0, 1);
    const diff90 = calculateDifference(cpLat, cpLon, 90, 1);
    const a = (360 - calculateBearing(cpLat, cpLon, refLat, refLon)) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);

    return treeGrid(height, width, spaceHeight, spaceWidth, true).map(([x, y]) => {
      const nx = x * cos - y * sin;
      const ny = x * sin + y * cos;
      const dLon = nx * diff90[1];
      const dLat = ny * diff0[0] + nx * diff90[0];
      return [cpLon + dLon, cpLat + dLat];
    });
  }

  // 方位角手入力モード: 各点を CP からの距離・方位に直して測地線で前進
  function treePlantingCoordinatesWithAzimuth(lat, lon, azimuthDeg, height, width, spaceHeight, spaceWidth) {
    const a = (360 - azimuthDeg) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);

    return treeGrid(height, width, spaceHeight, spaceWidth, false).map(([x, y]) => {
      const dx = x * cos - y * sin;
      const dy = x * sin + y * cos;
      const az = ((Math.atan2(dx, dy) * 180 / Math.PI) % 360 + 360) % 360;
      const d = geod.Direct(lat, lon, az, Math.hypot(dx, dy));
      return [d.lon2, d.lat2];
    });
  }

  function num(v) {
    const n = Number(v);
    if (v === null || v === undefined || v === '' || !Number.isFinite(n)) throw new Error(`invalid number: ${v}`);
    return n;
  }

  // ---- API ハンドラ ----
  function loadArrivals() {
    try { return JSON.parse(localStorage.getItem(ARRIVALS_KEY) || '[]'); } catch { return []; }
  }
  function saveArrivals(rows) {
    try { localStorage.setItem(ARRIVALS_KEY, JSON.stringify(rows)); } catch {}
  }

  const routes = {
    'GET /location': () => ({
      lat: sim.lat + noise(0.003) / 111320,
      lon: sim.lon + noise(0.003) / (111320 * Math.cos(sim.lat * Math.PI / 180)),
      alt: sim.alt + noise(0.01),
      mode: 3,
      status: 3,            // gpsd STATUS_RTK_FIX
      gga_fix_quality: 3,
      speed: sim.speed,
      epx: 0.012, epy: 0.014, epv: 0.025,
      sats: 18,
      hdop: 0.7,
      ts: Date.now() / 1000,
      gps_time: new Date().toISOString(),
    }),

    'GET /gnss-status': () => ({ connected: true, device_present: true, data_age_s: 0.1 }),

    'GET /power-status': () => ({
      voltage: 0.85, throttled_hex: '0x0',
      under_voltage_now: false, throttled_now: false,
      under_voltage_past: false, throttled_past: false,
      device_present: true,
    }),

    'GET /temperature': () => ({ temp_c: 48 + Math.random() * 2 }),

    'POST /calculate_distance_azimuth': (b) => {
      try {
        const r = geod.Inverse(num(b.current_lat), num(b.current_lon), num(b.target_lat), num(b.target_lon));
        return { distance: r.s12, azimuth: r.azi1 };
      } catch {
        return [400, { error: 'invalid coords' }];
      }
    },

    'POST /calculate': (b) => {
      try {
        const cpLat = num(b.cp_lat), cpLon = num(b.cp_lon);
        if (b.shape !== 'tree') return [400, { error: 'デモ版は植林（tree）形状のみ対応しています' }];
        const sh = num(b.tree_space_height), sw = num(b.tree_space_width);
        const h = Math.trunc(num(b.tree_height)), w = Math.trunc(num(b.tree_width));

        let result;
        if (b.azimuth_mode === 'ref') {
          result = treePlantingCoordinates(cpLat, cpLon, num(b.ref_lat), num(b.ref_lon), h, w, sh, sw);
        } else if (b.azimuth_mode === 'manual') {
          result = treePlantingCoordinatesWithAzimuth(cpLat, cpLon, num(b.manual_azimuth), h, w, sh, sw);
        } else {
          return [400, { error: '無効な方位角指定方法' }];
        }
        return { result };
      } catch (e) {
        return [400, { error: `入力に問題があります: ${e.message}` }];
      }
    },

    'POST /arrivals': (b) => {
      const lat = b.current_lat ?? sim.lat, lon = b.current_lon ?? sim.lon;
      const n = new Date(), p = v => String(v).padStart(2, '0');  // ローカル時刻の ISO 形式
      const ts = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}T${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
      const rows = loadArrivals();
      rows.push([ts, b.event ?? 'arrived', b.point_index, lat, lon, b.alt,
                 b.target_lat, b.target_lon, b.mode, b.status]);
      saveArrivals(rows);
      return { message: 'saved', timestamp: ts };
    },

    'POST /arrivals/clear': () => { saveArrivals([]); return { message: 'cleared' }; },

    'POST /shutdown': () => ({ message: 'デモ版のため電源操作は行いません。' }),
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const method = ((init && init.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const handler = url.origin === location.origin && routes[`${method} ${url.pathname}`];
    if (!handler) return realFetch(input, init);

    let body = {};
    try { body = JSON.parse((init && init.body) || '{}') || {}; } catch {}

    await new Promise(r => setTimeout(r, 20));  // 通信らしい遅延
    let out = handler(body);
    let status = 200;
    if (Array.isArray(out)) [status, out] = out;
    return new Response(JSON.stringify(out), { status, headers: { 'Content-Type': 'application/json' } });
  };

  // ---- 画面側の関数をデモ用に差し替え（本体スクリプト読み込み後）----
  const ARRIVAL_HEADER = ['timestamp_iso', 'event', 'point_index', 'current_lat', 'current_lon', 'alt',
                          'target_lat', 'target_lon', 'mode', 'status'];

  function overridePageFunctions() {
    window.downloadArrivalsCSV = function () {
      const esc = v => (v === null || v === undefined) ? '' : String(v);
      const csv = [ARRIVAL_HEADER, ...loadArrivals()].map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'arrivals.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    window.shutdownPi = function () {
      alert('デモ版のため電源OFFは動作しません。\n実機では Raspberry Pi をシャットダウンします。');
    };
  }

  // ---- デモ操作パネル ----
  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = `
      #demo-fab { position:fixed; right:12px; bottom:12px; z-index:9999; padding:8px 12px;
        border-radius:999px; border:1px solid var(--warn); background:var(--surface2); color:var(--warn);
        font:600 12px 'DM Mono',monospace; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.4); }
      #demo-panel { position:fixed; right:12px; bottom:56px; z-index:9999; width:min(280px, calc(100vw - 24px));
        padding:12px; border-radius:var(--radius); border:1px solid var(--border); background:var(--surface);
        color:var(--text); font-size:12px; box-shadow:0 4px 16px rgba(0,0,0,.5); display:none; }
      #demo-panel.open { display:block; }
      #demo-panel h4 { margin:0 0 6px; font-size:13px; color:var(--warn); }
      #demo-panel p { margin:0 0 8px; color:var(--text2); line-height:1.5; }
      #demo-panel .row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:6px 0; }
      #demo-panel select, #demo-panel button { font-size:12px; padding:4px 8px; border-radius:6px;
        border:1px solid var(--border); background:var(--surface2); color:var(--text); cursor:pointer; }
      #demo-pad { display:grid; grid-template-columns:repeat(3, 40px); gap:4px; justify-content:center; margin:8px 0; }
      #demo-pad button { height:34px; padding:0; }
      #demo-pos { font-family:'DM Mono',monospace; color:var(--text2); text-align:center; }
    `;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'demo-fab';
    fab.textContent = 'DEMO 擬似GPS';

    const panel = document.createElement('div');
    panel.id = 'demo-panel';
    panel.innerHTML = `
      <h4>デモ版（擬似GNSS）</h4>
      <p>受信機の代わりにブラウザ内で位置を作っています。誘導中（STEP 7）は次のポイントへ自動で歩きます。</p>
      <div class="row"><label for="demo-auto">自動歩行</label>
        <select id="demo-auto"><option value="1">ON</option><option value="0">OFF</option></select></div>
      <div class="row"><label for="demo-speed">歩行速度</label>
        <select id="demo-speed">
          <option value="1">1 m/s（徒歩）</option>
          <option value="3">3 m/s</option>
          <option value="10">10 m/s（早送り）</option>
        </select></div>
      <div class="row"><label for="demo-step">手動移動</label>
        <select id="demo-step">
          <option value="1">1 m</option><option value="5">5 m</option><option value="20" selected>20 m</option>
        </select></div>
      <div id="demo-pad">
        <span></span><button data-az="0" title="北へ">↑</button><span></span>
        <button data-az="270" title="西へ">←</button><button id="demo-reset" title="初期位置へ">●</button><button data-az="90" title="東へ">→</button>
        <span></span><button data-az="180" title="南へ">↓</button><span></span>
      </div>
      <div id="demo-pos"></div>
    `;

    document.body.append(fab, panel);
    fab.addEventListener('click', () => panel.classList.toggle('open'));
    panel.querySelector('#demo-auto').addEventListener('change', e => { sim.autoWalk = e.target.value === '1'; });
    panel.querySelector('#demo-speed').addEventListener('change', e => { sim.walkSpeed = Number(e.target.value); });
    panel.querySelectorAll('#demo-pad [data-az]').forEach(btn => btn.addEventListener('click', () => {
      moveBy(Number(btn.dataset.az), Number(panel.querySelector('#demo-step').value));
    }));
    panel.querySelector('#demo-reset').addEventListener('click', () => {
      sim.lat = START.lat; sim.lon = START.lon;
    });

    const posEl = panel.querySelector('#demo-pos');
    setInterval(() => { posEl.textContent = `${sim.lat.toFixed(7)}, ${sim.lon.toFixed(7)}`; }, 250);
  }

  document.addEventListener('DOMContentLoaded', () => {
    overridePageFunctions();
    buildPanel();
  });
})();
