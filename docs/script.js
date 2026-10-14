let corners = [];
let watchId;
let reachedPoints = 0;
let nextPointIndex = 0;
let currentDistanceThreshold = 0.1;
let num = 0;
let canvasOverlay = null;
let reached = [];
let inFlight = false;
let watchInterval = null;
let latestLocation = null;
let compassHeading = null; // スマホのコンパス方位（北=0°）
let lastArrowAngle = 0;
let lastCompassHeading = null;


// 初期化
document.addEventListener('DOMContentLoaded', () => {
  initializeDistanceView();

  document.getElementById('watch_position_button')
    ?.addEventListener('click', startWatching);
});

// 水平1σを epx/epy から算出（ある時だけ）
function h1sFrom(q){
  const epx = q?.epx, epy = q?.epy;
  if (typeof epx === 'number' && typeof epy === 'number') return Math.max(epx, epy);
  return null;
}

// 次の目標ポイントだけを丸で描画（ctx は translate(cx,cy) + rotate(rad) 済み）
function drawPlantationCircles(ctx, cx, cy) {
  if (!latestLocation || !corners || corners.length === 0 || nextPointIndex >= corners.length) return;
  const curLat = latestLocation.lat, curLon = latestLocation.lon;
  if (typeof curLat !== 'number' || typeof curLon !== 'number') return;

  const c = corners[nextPointIndex];
  const DEG2RAD = Math.PI / 180;
  const dx = (c[0] - curLon) * Math.cos(curLat * DEG2RAD) * 111320;
  const dy = (c[1] - curLat) * 110540;
  const d = Math.sqrt(dx * dx + dy * dy);

  // 5m以内で最大10px、最小3px
  const r = 3 + 7 * Math.max(0, 1 - d / 5);
  const px = 0, py = -(Math.min(cx, cy) - 22);

  if (d < 5) {
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(px, py, r + 4, 0, 2 * Math.PI);
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  ctx.globalAlpha = 1.0;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, 2 * Math.PI);
  ctx.fillStyle = '#58a6ff';
  ctx.fill();
  ctx.globalAlpha = 1;
}

// 受信状態を判定してラベル/色を返す
function classifyFixStatus(q, devicePresent) {
    const gga = q?.gga_fix_quality;
    const mode = q?.mode;

    // USBの認識がない場合に限り「切断」、認識はあるが位置未取得なら「取得中」
    if (devicePresent === false) {
        return { label: '切断', color: '#ef4444', h1s: null };
    }
    if (mode === 1 || gga === 0 || gga == null) {
        return { label: '取得中', color: '#9ca3af', h1s: null };
    }
    // gga_fix_quality は gpsd の STATUS 値（NMEA GGA のコードとは異なる）
    // 1=GPS, 2=DGPS, 3=RTK_FIX, 4=RTK_FLT
    if (gga === 3) {
        return { label: 'RTK固定', color: '#16a34a', h1s: h1sFrom(q) };
    }
    if (gga === 4) {
        return { label: 'RTKフロート', color: '#f59e0b', h1s: h1sFrom(q) };
    }
    if (gga === 2) {
        return { label: 'DGPS', color: '#f97316', h1s: h1sFrom(q) };
    }
    if (gga === 1) {
        return { label: 'Single', color: '#ef4444', h1s: h1sFrom(q) };
    }
    return { label: `不明(Q:${gga})`, color: '#9ca3af', h1s: h1sFrom(q) };
}

// #distance の初期化
function initializeDistanceView() {
  const distanceDiv = document.getElementById('distance');
  distanceDiv.innerHTML = `
    <div style="text-align: left; margin: 10px 12px 6px;">
      <pre id="position_view" style="margin:0; white-space: pre-wrap;"></pre>
    </div>

    <hr style="margin: 6px 12px; border-color: var(--border);">

    <p style="margin: 0 12px 6px;">
      ポイント <span id="point-index">1</span> まで<br>
      距離: <span id="distance-value">0</span> メートル<br>
      方位: <span id="azimuth-value">0</span> 度
    </p>
    <div style="text-align: center; margin: 6px 0 10px;">
      <canvas id="direction-arrow" width="100" height="100"></canvas>
    </div>
  `;
  setTimeout(() => {
    try {
      updatePointIndexUI();
      updateNavButtons();
    } catch {}
  }, 0);
}

// #distance の更新　box
function updateDistanceAndAzimuth(nextPointIndex, data) {
  const idxEl = document.getElementById('point-index');
  const distEl = document.getElementById('distance-value');
  const azEl = document.getElementById('azimuth-value');
  const canvas = document.getElementById('direction-arrow');

  if (!idxEl || !distEl || !azEl || !canvas) return;

  idxEl.textContent = nextPointIndex + 1;
  distEl.textContent = data.distance.toFixed(2);
  azEl.textContent = data.azimuth.toFixed(2);

  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;

  const heading = compassHeading ?? 0;
  const relativeAngle = ((data.azimuth - heading) % 360 + 360) % 360;
  const rad = (relativeAngle) * Math.PI / 180;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(cx, cy);

  // 植林ポイントの丸を回転（目標が常に上に来る）
  ctx.save();
  ctx.rotate(rad);
  drawPlantationCircles(ctx, cx, cy);
  ctx.restore();

  // 十字線（固定）
  ctx.strokeStyle = '#aaaaaa';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -cy);
  ctx.lineTo(0, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-cx, 0);
  ctx.lineTo(cx, 0);
  ctx.stroke();

  // 矢印（固定・常に上向き）
  ctx.beginPath();
  ctx.moveTo(0, -24);
  ctx.lineTo(9, 11);
  ctx.lineTo(0, 5);
  ctx.lineTo(-9, 11);
  ctx.closePath();
  ctx.fillStyle = '#e53e3e';
  ctx.fill();

  ctx.restore();
}
function updateThreshold() {
    const mode = document.getElementById('threshold-selector')?.value;
    
    if (mode === 'standard') {
        currentDistanceThreshold = 3.0; // 3メートル
        console.log("到着判定閾値を 3.0m (標準) に設定しました");
    } else {
        currentDistanceThreshold = 0.1; // 10センチメートル
        console.log("到着判定閾値を 0.1m (高精度) に設定しました");
    }
}

// 形状選択に応じて入力フィールドを切り替える関数
function toggleInputFields() {
  const shape = document.getElementById('shape').value;
  const trackInputs = document.getElementById('track-inputs');
  const rectangleInputs = document.getElementById('rectangle-inputs');
  const treeInputs = document.getElementById('tree-inputs');
  const customRectInputs = document.getElementById('custom-rectangle-inputs'); // ★追加

  trackInputs.classList.add('hidden');
  rectangleInputs.classList.add('hidden');
  treeInputs.classList.add('hidden');
  if (customRectInputs) customRectInputs.classList.add('hidden'); // ★追加

  if (shape === 'track') {
    trackInputs.classList.remove('hidden');
  } else if (shape === 'rectangle') {
    rectangleInputs.classList.remove('hidden');
  } else if (shape === 'tree') {
    treeInputs.classList.remove('hidden');
  } else if (shape === 'custom_rect') { // ★追加
    customRectInputs.classList.remove('hidden');
  }
}


function toggleAzimuthInput() {
    const isManual = document.getElementById('mode_manual').checked;
    document.getElementById('ref-inputs').classList.toggle('hidden', isManual);
    document.getElementById('manual-azimuth-input').classList.toggle('hidden', !isManual);
}

// ==== 1. 10秒間データを収集して平均する関数 ====
// 更新間隔が1秒のため、10秒間で10サンプル収集
function getAveragePosition(callback, onProgress) {
    let positions = [];
    const DURATION_MS = 10000; // 計測時間: 10秒
    const INTERVAL_MS = 1000;  // ポーリング間隔: 1秒
    const startTime   = Date.now();

    console.log("受信機(GNSS)からのデータ取得を開始します... (10秒間)");

    const interval = setInterval(async () => {
        const elapsed = Date.now() - startTime;

        try {
            const response = await fetch('/location');
            if (response.ok) {
                const data = await response.json();
                if (data.lat != null && data.lon != null) {
                    positions.push({ lat: data.lat, lon: data.lon });
                    console.log(`取得中 (${positions.length}件, ${(elapsed/1000).toFixed(1)}s): ${data.lat}, ${data.lon}`);
                } else {
                    console.warn("データ取得中... (衛星捕捉待ち or No Fix)");
                }
            } else {
                console.error("サーバーエラー: /location にアクセスできません");
            }
        } catch (err) {
            console.error("通信エラー:", err);
        }

        // 進捗コールバック（残り秒数をUIに反映するため）
        const remaining = Math.max(0, Math.ceil((DURATION_MS - elapsed) / 1000));
        if (typeof onProgress === 'function') onProgress(remaining, positions.length);

        // 10秒経過したら終了
        if (elapsed >= DURATION_MS) {
            clearInterval(interval);

            if (positions.length === 0) {
                console.error("有効な位置データを取得できませんでした");
                alert("位置データを取得できませんでした。GNSSの受信状態を確認してください。");
                return;
            }

            const avgLat = positions.reduce((sum, pos) => sum + pos.lat, 0) / positions.length;
            const avgLon = positions.reduce((sum, pos) => sum + pos.lon, 0) / positions.length;

            console.log(`平均計算完了 (${positions.length}件):`, avgLat, avgLon);
            callback(avgLat, avgLon);
        }
    }, INTERVAL_MS);
}

// ==== 2. CP (現在地) の取得ボタン用 ====
function getCPPosition() {
    const btn = document.getElementById('get_cp_button');
    const statusEl = document.getElementById('cp_status');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 計測中 10秒...'; }
    if (statusEl) { statusEl.classList.remove('hidden'); statusEl.className = 'info-box'; statusEl.textContent = '計測中... 残り10秒'; }

    getAveragePosition(
        (lat, lon) => {
            // 入力欄に値をセット
            document.getElementById('cp_lat').value = lat.toFixed(8);
            document.getElementById('cp_lon').value = lon.toFixed(8);

            if (btn) { btn.disabled = false; btn.textContent = '現在地を再取得（10秒平均）'; }
            if (statusEl) { statusEl.className = 'info-box success'; statusEl.textContent = `✓ CP取得完了: ${lat.toFixed(6)}, ${lon.toFixed(6)}`; }

            document.getElementById('btn-4-next').disabled = false;
            saveSession({ cp_lat: lat.toFixed(8), cp_lon: lon.toFixed(8) });
        },
        (remaining, count) => {
            if (btn) btn.innerHTML = `<span class="spinner"></span> 計測中 残り${remaining}秒 (${count}件)`;
            if (statusEl) {
                const loc = window.latestLocation;
                const coord = (loc && loc.lat != null && loc.lon != null)
                    ? `現在地: ${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}`
                    : '現在地: 取得中...';
                statusEl.textContent = coord;
            }
        }
    );
}

// ==== 3. 参照点の取得ボタン用 ====
function getRefPosition() {
    const btn = document.getElementById('get_ref_button');
    const statusEl = document.getElementById('azimuth-status');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 計測中 10秒...'; }
    if (statusEl) { statusEl.classList.remove('hidden'); statusEl.className = 'info-box'; statusEl.textContent = '計測中... 残り10秒'; }

    getAveragePosition(
        (lat, lon) => {
            document.getElementById('ref_lat').value = lat.toFixed(8);
            document.getElementById('ref_lon').value = lon.toFixed(8);

            if (btn) { btn.disabled = false; btn.textContent = '参照点の位置情報を再取得'; }
            if (statusEl) { statusEl.className = 'info-box success'; statusEl.textContent = `✓ 参照点: ${lat.toFixed(6)}, ${lon.toFixed(6)}`; }

            saveSession({ ref_lat: lat.toFixed(8), ref_lon: lon.toFixed(8) });
        },
        (remaining, count) => {
            if (btn) btn.innerHTML = `<span class="spinner"></span> 計測中 残り${remaining}秒 (${count}件)`;
            if (statusEl) statusEl.textContent = `計測中... 残り${remaining}秒 (${count}件取得済)`;
        }
    );
}

// ★追加：UI上のポイント番号だけ即時更新するユーティリティ
function updatePointIndexUI() {
    const idxSpan = document.getElementById('point-index');
    if (!idxSpan) return;
    if (corners.length === 0) {
        idxSpan.textContent = '--';
    } else {
        idxSpan.textContent = Math.min(nextPointIndex + 1, corners.length);
    }
}

// ★追加：現在のターゲットをスキップ
function skipCurrentPoint() {
  if (!corners || corners.length === 0) return;

  if (nextPointIndex < corners.length) {
    const skippedIndex = nextPointIndex;
    const skippedCorner = corners[skippedIndex];
    reached[nextPointIndex] = true;
    nextPointIndex++;
    postSkipLog(skippedIndex, skippedCorner);
    updatePointIndexUI();
    updateNavButtons();

    if (nextPointIndex >= corners.length) {
      // 最後のポイントをスキップ → 完了ダイアログのみ
      updateNextPointMessage();
    } else {
      alert('現在のポイントをスキップしました。次のポイントへ案内します。');
    }
  }

  // 全部終わったらボタンも無効化
  if (nextPointIndex >= corners.length) {
    const skipBtn = document.getElementById('skip_point_button');
    if (skipBtn) skipBtn.disabled = true;
    stopWatching();
  }
}

function updateNavButtons() {
  const skipBtn = document.getElementById('skip_point_button');
  const prevBtn = document.getElementById('prev_point_button');

  // 前へ戻る：最初のポイントなら無効
  if (prevBtn) prevBtn.disabled = (nextPointIndex <= 0);

  // スキップ：最後のポイントを超えたら無効（＝案内終了時は無効）
  const canSkip = corners && nextPointIndex < corners.length;
  if (skipBtn) skipBtn.disabled = !canSkip;
}

function goBackToPreviousPoint() {
  if (!corners || corners.length === 0) return;

  if (nextPointIndex <= 0) {
    alert('すでに最初のポイントです。');
    return;
  }

  // もし完走後の「到達しました」表示で #distance の中身が切り替わっていたら、UIを復元
  if (!document.getElementById('direction-arrow')) {
    initializeDistanceView();
  }

  // ひとつ前に戻す（その点は未到達扱いに）
  nextPointIndex--;
  if (Array.isArray(reached)) reached[nextPointIndex] = false;

  updatePointIndexUI();

  // 位置取得が止まっていたら再開（完了時に stopWatching() 済みのケース対応）
  if (!watchInterval) {
    startWatching();
  }

  // ボタン状態の更新
  updateNavButtons();

  alert(`ポイント ${nextPointIndex + 1} へ戻しました。`);
}

// setTargetPoints関数で初期化
function setTargetPoints() {
  if (!Array.isArray(corners)) corners = [];
  reached = new Array(corners.length).fill(false);

  // 距離ボックスが「完了画面」になっていたら復元
  if (!document.getElementById('direction-arrow')) {
    initializeDistanceView();
  }

  // ★追加: 結果0件の特別扱い
  if (corners.length === 0) {
    // UI同期（番号は1固定表示のままでもOKだが、0件を示したいなら "--" などにしてもよい）
    updatePointIndexUI();
    updateNavButtons();

    // 距離ボックスにメッセージ
    const distanceBox = document.getElementById('distance');
    if (distanceBox) {
      distanceBox.innerHTML = `
        <div style="padding:16px; text-align:center;">
          <p style="margin:8px 0;">計算結果にポイントがありませんでした。</p>
          <p style="margin:8px 0; font-size:12px; color:#666;">
            入力値（形状・寸法・CP/参照点）をご確認ください。
          </p>
        </div>
      `;
    }
    return; // ★ここで終了（「すべて到達🎉」は出さない）
  }

  // 通常ケース
  updatePointIndexUI();
  updateNavButtons();
  updateNextPointMessage();
}

function startWatching() {
  const wpBtn = document.getElementById('watch_position_button');
  if (wpBtn) wpBtn.disabled = true;
  if (watchInterval) return;

  // 1秒ごとにPiの位置を取得
  watchInterval = setInterval(() => {
    requestPiLocation();
  }, 1000);
}

function stopWatching() {
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
  }
  const wpBtn = document.getElementById('watch_position_button');
  if (wpBtn) wpBtn.disabled = false;
}

function requestPiLocation(){
  Promise.all([
    fetch('/location', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject(r.status)),
    fetch('/gnss-status', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)
  ])
    .then(([data, gs]) => {
      const lat = data.lat;
      const lon = data.lon;
      const devicePresent = gs ? gs.device_present : undefined;
      latestLocation = data;
      window.latestLocation = data;

      // ★追加：リアルタイムでもCP欄を更新
      const nowLatEl = document.getElementById('now_lat');
      const nowLonEl = document.getElementById('now_lon');
      if (typeof lat === 'number' && typeof lon === 'number') {
        if (nowLatEl) nowLatEl.value = lat.toFixed(8);
        if (nowLonEl) nowLonEl.value = lon.toFixed(8);
      }

      showPosition({
        coords: {
          latitude:  lat,
          longitude: lon,
          altitude:  (typeof data.alt === 'number') ? data.alt : null,
          accuracy:  (data.epx && data.epy) ? Math.max(data.epx, data.epy) : 0.05
        },
        quality: {
          gga_fix_quality: data.gga_fix_quality,
          status: data.status,
          mode: data.mode,
          epx: data.epx, epy: data.epy, epv: data.epv,
          hdop: data.hdop,
          sats: data.sats
        },
        devicePresent
      });
    })
    .catch(err => {
      console.error("位置情報取得エラー:", err);
      // 切断時にUIを更新
      const pv = document.getElementById('position_view');
      if (pv) {
        pv.innerHTML = `現在地: --- (受信不可)\n受信状態: <span class="fix-badge" style="background:#ef4444; padding:2px 6px; border-radius:4px; color:white;">切断</span>`;
      }
      updatePowerMonitor();
    });
}


// showPosition関数
function showPosition(position) {
    const currentLat = position.coords?.latitude;
    const currentLon = position.coords?.longitude;
    
    // UI初期化（消えていたら復元）
    if (!document.getElementById('position_view')) {
        initializeDistanceView();
    }
    
    const pv = document.getElementById('position_view');
    if (pv){
        const q = position.quality || {};
        const fx = classifyFixStatus(q, position.devicePresent);
        const qualityNum = (typeof q.gga_fix_quality === 'number') ? `(Q:${q.gga_fix_quality})` : '';

        // 緯度経度がある場合とない場合で表示を分ける
        let latLonText = "データ待機中...";
        if (typeof currentLat === 'number' && typeof currentLon === 'number') {
            latLonText = `(${currentLat.toFixed(8)}, ${currentLon.toFixed(8)})`;
        } else {
            latLonText = "--- (受信不可)";
        }

        const lines = [
            `現在地: ${latLonText}`,
            `受信状態: <span class="fix-badge" style="background:${fx.color}; padding:2px 6px; border-radius:4px; color:white;">${fx.label} ${qualityNum}</span>`,
            (fx.h1s != null) ? `水平1σ: ${fx.h1s.toFixed(3)} m` : null,
            (typeof q.hdop === 'number') ? `HDOP: ${q.hdop.toFixed(2)}` : null,
            `取得回数: ${++num}`
        ].filter(Boolean).join('\n');
        
        pv.innerHTML = lines; 
    }
    
    if (typeof currentLat !== 'number' || typeof currentLon !== 'number') {
        return;
    }

    // ---- 3. 以下、地図と距離計算（座標がある場合のみ実行） ----
    
    // 全到達なら終了
    if (nextPointIndex >= corners.length) return;
    const localIndex = nextPointIndex;
    const corner = corners[localIndex];
    if (!corner) return;
    
    // 距離計算APIへ送信
    if (inFlight) {
        checkProximity(currentLat, currentLon);
        return;
    }
    inFlight = true;

    const _ac = new AbortController();
    const _timer = setTimeout(() => _ac.abort(), 3000);

    fetch('/calculate_distance_azimuth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            current_lat: currentLat, current_lon: currentLon,
            target_lat: corner[1], target_lon: corner[0]
        }),
        signal: _ac.signal
    })
    .then(res => res.ok ? res.json() : Promise.reject(res.status))
    .then(data => {
        if (nextPointIndex >= corners.length || localIndex !== nextPointIndex) return;
        updateDistanceAndAzimuth(localIndex, {
            distance: data.distance,
            azimuth: ((data.azimuth % 360) + 360) % 360
        });
        checkProximity(currentLat, currentLon, data.distance);
    })
    .catch(err => { if (err.name !== 'AbortError') console.error(err); })
    .finally(() => { clearTimeout(_timer); inFlight = false; });

}

// 第3引数に givenDistance を追加
function checkProximity(currentLat, currentLon, givenDistance) {
  if (nextPointIndex >= corners.length) return;

  const corner = corners[nextPointIndex];
  // const targetLat = corner[1]; // 今回は使わなくて済むかもしれません
  // const targetLon = corner[0];

  let distance = givenDistance;

  if (typeof distance !== 'number') {
      return; 
  }

  // 2. 設定された閾値 (currentDistanceThreshold) と比較
  // ★距離(distance)はすでに計算済みなのでそのまま使います
  if (!reached[nextPointIndex] && distance <= currentDistanceThreshold) {
    reached[nextPointIndex] = true;
    
    alert(`ポイント${nextPointIndex + 1}に到着しました。`);
    
    // ログ保存：地形により到着判定地点に植えられない場合があるため、
    // ダイアログで OK を押した時点の位置を記録する（記録した位置で resolve）
    window._lastArrivalRecord = postArrivalLog(nextPointIndex, corner, currentLat, currentLon);
    nextPointIndex++;

    updatePointIndexUI();
    updateNavButtons();
    updateNextPointMessage();

    if (nextPointIndex >= corners.length) {
      stopWatching(); 
    }
  }
}

function updateNextPointMessage() {
    const distanceBox = document.getElementById('distance');

    if (nextPointIndex < corners.length) {
        // 特に表示しない場合は何もしない
        return;
    } else {
        distanceBox.innerHTML = `
            <div style="height: 100%; display: flex; justify-content: center; align-items: center; text-align: center;">
                <p style="font-size: 1.1em;">すべてのポイントに到達しました 🎉</p>
            </div>
        `;
        alert("すべてのポイントに到達しました！");

        // ★追加：スキップボタンを無効化
        const skipBtn = document.getElementById('skip_point_button');
        if (skipBtn) skipBtn.disabled = true;

        updateNavButtons();
    }
}

async function postArrivalLog(pointIndex, corner, currentLat, currentLon) {
  // OK 押下後の最新位置を取得（alert 中はポーリングが止まるため latestLocation は古い）
  let d = latestLocation || {};
  try {
    const r = await fetch('/location', { cache: 'no-store' });
    if (r.ok) {
      const fresh = await r.json();
      if (typeof fresh.lat === 'number' && typeof fresh.lon === 'number') {
        d = fresh;
        latestLocation = fresh;
        window.latestLocation = fresh;
        currentLat = fresh.lat;
        currentLon = fresh.lon;
      }
    }
  } catch (e) {
    console.warn("OK押下時の位置取得に失敗（到着判定時の位置で記録）:", e);
  }
  try {
    await fetch('/arrivals', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        event: 'arrived',
        point_index: pointIndex + 1,     // 1始まり
        current_lat: currentLat,
        current_lon: currentLon,
        alt: (typeof d.alt === 'number') ? d.alt : null,
        target_lat: corner?.[1],
        target_lon: corner?.[0],
        mode: d.mode,
        status: d.status
      })
    });
  } catch (e) {
    console.warn("到着ログ保存に失敗:", e);
  }
  return { lat: currentLat, lon: currentLon };
}

async function postSkipLog(pointIndex, corner) {
  try {
    const d = latestLocation || {};
    await fetch('/arrivals', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        event: 'skipped',
        point_index: pointIndex + 1,     // 1始まり
        current_lat: (typeof d.lat === 'number') ? d.lat : null,
        current_lon: (typeof d.lon === 'number') ? d.lon : null,
        alt: (typeof d.alt === 'number') ? d.alt : null,
        target_lat: corner?.[1],
        target_lon: corner?.[0],
        mode: d.mode,
        status: d.status
      })
    });
  } catch (e) {
    console.warn("スキップログ保存に失敗:", e);
  }
}

function downloadArrivalsCSV(){
  window.location.href = "/arrivals.csv";
}

async function clearArrivals(){
  if(!confirm("到着ログCSVを初期化しますか？")) return;
  await fetch("/arrivals/clear", {method:"POST"});
  alert("到着ログをクリアしました。");
}

function listenOrientation() {
  let usingAbsolute = false;

  window.addEventListener('deviceorientationabsolute', (e) => {
    usingAbsolute = true;
    onOrientation(e);
  }, true);

  window.addEventListener('deviceorientation', (e) => {
    if (!usingAbsolute) onOrientation(e); // absoluteが使えない時だけ
  }, true);
}

function onOrientation(e) {
  if (e.absolute && e.alpha !== null) {
    compassHeading = e.alpha;
  } else if (!e.absolute && e.webkitCompassHeading !== undefined) {
    compassHeading = e.webkitCompassHeading;
  }

  // ボタンに現在の角度を表示
  const btn = document.getElementById('compass_button');
  if (btn && compassHeading !== null) {
    btn.textContent = `コンパス: ${Math.round(compassHeading)}°`;
  }
}