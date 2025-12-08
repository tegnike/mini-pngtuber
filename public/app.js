(() => {
  const qs = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));

  const els = {
    settingsToggle: qs('#settingsToggle'),
    controlsPanel: qs('.controls'),
    micToggle: qs('#micToggle'),
    micIconOn: qs('#micIconOn'),
    micIconOff: qs('#micIconOff'),
    toggleBtn: qs('#toggleMicBtn'),
    refreshBtn: qs('#refreshDevicesBtn'),
    deviceSelect: qs('#deviceSelect'),
    threshold: qs('#threshold'),
    thresholdVal: qs('#thresholdVal'),
    toggleInterval: qs('#toggleInterval'),
    toggleIntervalVal: qs('#toggleIntervalVal'),
    smoothing: qs('#smoothing'),
    smoothingVal: qs('#smoothingVal'),
    bgColor: qs('#bgColor'),
    bgColorVal: qs('#bgColorVal'),
    gain: qs('#gain'),
    gainVal: qs('#gainVal'),
    scale: qs('#scale'),
    scaleVal: qs('#scaleVal'),
    // 4画像選択セレクト
    imageMouthClosedEyesOpen: qs('#imageMouthClosedEyesOpen'),
    imageMouthClosedEyesClosed: qs('#imageMouthClosedEyesClosed'),
    imageMouthOpenEyesOpen: qs('#imageMouthOpenEyesOpen'),
    imageMouthOpenEyesClosed: qs('#imageMouthOpenEyesClosed'),
    // 4画像要素
    imgMouthClosedEyesOpen: qs('#imgMouthClosedEyesOpen'),
    imgMouthClosedEyesClosed: qs('#imgMouthClosedEyesClosed'),
    imgMouthOpenEyesOpen: qs('#imgMouthOpenEyesOpen'),
    imgMouthOpenEyesClosed: qs('#imgMouthOpenEyesClosed'),
    // 瞬き設定UI
    blinkEnabled: qs('#blinkEnabled'),
    blinkIntervalMin: qs('#blinkIntervalMin'),
    blinkIntervalMinVal: qs('#blinkIntervalMinVal'),
    blinkIntervalMax: qs('#blinkIntervalMax'),
    blinkIntervalMaxVal: qs('#blinkIntervalMaxVal'),
    blinkDuration: qs('#blinkDuration'),
    blinkDurationVal: qs('#blinkDurationVal'),
    avatar: qs('#avatar'),
    meter: qs('#meter'),
    meterBar: qs('#meterBar'),
    meterOpen: qs('#meterOpen'),
    meterClose: qs('#meterClose'),
    showMeter: qs('#showMeter'),
    error: qs('#error'),
  };

  let started = false;
  let audioContext = null;
  let analyser = null;
  let sourceNode = null;
  let rafId = null;
  let stream = null;

  const timeData = new Uint8Array(2048);
  let floatData = null; // reused for float time-domain reads
  let smoothVolume = 0; // normalized 0..1
  let baseline = 0;     // ambient noise baseline (deprecated)
  let calibrating = false;
  let calibSum = 0;
  let calibCount = 0;
  let mouthOpen = false;
  let eyesOpen = true;           // 目の開閉状態
  let currentState = { mouthOpen: false, eyesOpen: true }; // for animation control
  let fadeToken = 0; // cancel stale transitions
  let blinkTimeoutId = null;     // 次の瞬きタイマー
  let blinkEndTimeoutId = null;  // 瞬き終了タイマー

  const state = {
    threshold: 0.35, // 0..1
    toggleInterval: 0.1, // toggle interval in seconds (0.1..1.0)
    smoothing: 0.70, // 0..0.95
    deviceId: null,
    gain: 3.0, // input gain multiplier
    bgColor: '#0b0f14',
    scalePct: 100,
    // 瞬き設定
    blinkEnabled: true,
    blinkIntervalMin: 2.0,  // 秒
    blinkIntervalMax: 6.0,  // 秒
    blinkDuration: 150,     // ms
  };

  // For mouth toggle animation
  let isSpeaking = false;
  let lastToggleTime = 0;

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  function rmsFromTimeData(buf) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128; // -1..1
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length); // 0..1
  }

  async function fetchImages() {
    // Electron環境ではIPC通信を使用
    if (window.electronAPI?.isElectron) {
      try {
        const result = await window.electronAPI.getImages();
        return result.images || [];
      } catch (e) {
        console.error('IPC画像取得エラー:', e);
        return [];
      }
    }
    // ブラウザ環境では従来のHTTP fetchを使用
    try {
      const res = await fetch('/images', { cache: 'no-cache' });
      if (!res.ok) throw new Error('failed');
      const json = await res.json();
      return json.images || [];
    } catch (e) {
      return [];
    }
  }

  function guessDefaults(images) {
    // 4画像方式のデフォルト推定
    const find = (patterns) => {
      for (const p of patterns) {
        const match = images.find(n => p.test(n));
        if (match) return match;
      }
      return null;
    };

    return {
      mouthClosedEyesOpen: find([/closed.*eyes?.*open/i, /close.*open/i]) || images[0],
      mouthClosedEyesClosed: find([/closed.*eyes?.*closed/i, /close.*close/i, /blink/i]) || images[1] || images[0],
      mouthOpenEyesOpen: find([/open.*eyes?.*open/i, /open.*open/i, /talk/i]) || images[2] || images[0],
      mouthOpenEyesClosed: find([/open.*eyes?.*closed/i, /open.*close/i]) || images[3] || images[0],
    };
  }

  function populateImageSelects(images) {
    // Electron環境では相対パス、ブラウザ環境では絶対パス
    const prefix = window.electronAPI?.isElectron ? './' : '/';
    const opts = images.map((name) => `<option value="${prefix}${encodeURIComponent(name)}">${name}</option>`).join('');
    els.imageMouthClosedEyesOpen.innerHTML = opts;
    els.imageMouthClosedEyesClosed.innerHTML = opts;
    els.imageMouthOpenEyesOpen.innerHTML = opts;
    els.imageMouthOpenEyesClosed.innerHTML = opts;

    const defaults = guessDefaults(images);
    if (defaults.mouthClosedEyesOpen) els.imageMouthClosedEyesOpen.value = `${prefix}${defaults.mouthClosedEyesOpen}`;
    if (defaults.mouthClosedEyesClosed) els.imageMouthClosedEyesClosed.value = `${prefix}${defaults.mouthClosedEyesClosed}`;
    if (defaults.mouthOpenEyesOpen) els.imageMouthOpenEyesOpen.value = `${prefix}${defaults.mouthOpenEyesOpen}`;
    if (defaults.mouthOpenEyesClosed) els.imageMouthOpenEyesClosed.value = `${prefix}${defaults.mouthOpenEyesClosed}`;
    updateImages();
  }

  function updateImages() {
    els.imgMouthClosedEyesOpen.src = els.imageMouthClosedEyesOpen.value || '';
    els.imgMouthClosedEyesClosed.src = els.imageMouthClosedEyesClosed.value || '';
    els.imgMouthOpenEyesOpen.src = els.imageMouthOpenEyesOpen.value || '';
    els.imgMouthOpenEyesClosed.src = els.imageMouthOpenEyesClosed.value || '';
    saveSettings();
  }

  function updateScale() {
    const pct = parseInt(els.scale.value, 10);
    els.scaleVal.textContent = `${pct}%`;
    els.avatar.style.maxWidth = `${Math.round(6.4 * pct)}px`; // 640px at 100%
    state.scalePct = pct;
    saveSettings();
  }

  function updateSlidersUI() {
    const thr = parseInt(els.threshold.value, 10) / 100;
    const interval = parseInt(els.toggleInterval.value, 10) / 10; // 0.1..1.0 seconds
    const sm = parseInt(els.smoothing.value, 10) / 100; // 0..0.95 (we'll clamp)
    const g = parseInt(els.gain.value, 10) / 100; // 0.5 .. 6.0
    state.threshold = clamp(thr, 0, 1);
    state.toggleInterval = clamp(interval, 0.1, 1.0);
    state.smoothing = clamp(sm, 0, 0.95);
    state.gain = clamp(g, 0.5, 6.0);
    els.thresholdVal.textContent = state.threshold.toFixed(2);
    els.toggleIntervalVal.textContent = state.toggleInterval.toFixed(1);
    els.smoothingVal.textContent = state.smoothing.toFixed(2);
    els.gainVal.textContent = state.gain.toFixed(1) + 'x';

    // Update meter threshold (single line now)
    els.meterOpen.style.left = `${state.threshold * 100}%`;
    els.meterClose.style.display = 'none'; // Hide second threshold line
    saveSettings();
  }

  async function fillDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      const prev = els.deviceSelect.value;
      els.deviceSelect.innerHTML = inputs.map((d) => `<option value="${d.deviceId}">${d.label || 'マイク'}</option>`).join('');
      if (inputs.length) {
        const idx = inputs.findIndex((d) => d.deviceId === prev);
        // Try saved deviceId first
        let target = null;
        try {
          const savedRaw = localStorage.getItem('pngtuber-settings-v1');
          if (savedRaw) {
            const saved = JSON.parse(savedRaw);
            if (saved && saved.deviceId) target = saved.deviceId;
          }
        } catch (_) {}
        const chosen = target && inputs.some((d) => d.deviceId === target)
          ? target
          : (idx >= 0 ? prev : inputs[0].deviceId);
        els.deviceSelect.value = chosen;
        state.deviceId = chosen;
        saveSettings();
      }
    } catch (_) {
      // silently ignore
    }
  }

  async function startMic() {
    if (started) return;
    els.error.textContent = '';
    try {
      const audioOpts = state.deviceId ? { deviceId: { exact: state.deviceId } } : {};
      Object.assign(audioOpts, {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      });
      const constraints = { audio: audioOpts, video: false };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.0; // not used for time-domain; keep 0
      sourceNode.connect(analyser);
      floatData = new Float32Array(analyser.fftSize);

      // After permission granted, device labels become available
      await fillDevices();

      // Baseline calibration disabled; using peak detection for sensitivity

      started = true;
      els.toggleBtn.textContent = 'マイク停止';
      updateMicButton(true);
      scheduleNextBlink();
      loop();
    } catch (err) {
      console.error(err);
      els.error.textContent = 'マイクにアクセスできませんでした。権限とデバイスを確認してください。';
      stopMic();
    }
  }

  function stopMic() {
    stopBlinking();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    analyser = null;
    sourceNode = null;
    started = false;
    mouthOpen = false;
    eyesOpen = true;
    smoothVolume = 0;
    isSpeaking = false;
    lastToggleTime = 0;
    // Reset visibility to closed (mouth closed, eyes open)
    getAllImages().forEach(img => {
      img.style.transition = 'none';
      img.style.opacity = '0';
    });
    els.imgMouthClosedEyesOpen.style.opacity = '1';
    currentState = { mouthOpen: false, eyesOpen: true };
    els.toggleBtn.textContent = 'マイク開始';
    updateMicButton(false);
    updateMeter(0);
  }

  function updateMeter(v) {
    if (!els.showMeter.checked) {
      els.meter.style.visibility = 'hidden';
      return;
    }
    els.meter.style.visibility = 'visible';
    els.meterBar.style.width = `${clamp(v, 0, 1) * 100}%`;
  }

  function loop() {
    if (!analyser) return;
    const level = getTimeDomainPeak();

    let v = clamp(level * state.gain, 0, 1);
    // Exponential smoothing
    smoothVolume = state.smoothing * smoothVolume + (1 - state.smoothing) * v;

    const now = performance.now();
    const intervalMs = state.toggleInterval * 1000;

    if (smoothVolume >= state.threshold) {
      // Speaking - toggle mouth at interval
      if (!isSpeaking) {
        isSpeaking = true;
        mouthOpen = true;
        lastToggleTime = now;
      } else if (now - lastToggleTime >= intervalMs) {
        mouthOpen = !mouthOpen;
        lastToggleTime = now;
      }
    } else {
      // Not speaking - close mouth
      isSpeaking = false;
      mouthOpen = false;
    }

    applyAvatarState();
    updateMeter(smoothVolume);

    rafId = requestAnimationFrame(loop);
  }

  // 4画像から表示すべき画像を取得
  function getTargetImage(isMouthOpen, isEyesOpen) {
    if (isMouthOpen && isEyesOpen) return els.imgMouthOpenEyesOpen;
    if (isMouthOpen && !isEyesOpen) return els.imgMouthOpenEyesClosed;
    if (!isMouthOpen && isEyesOpen) return els.imgMouthClosedEyesOpen;
    return els.imgMouthClosedEyesClosed;
  }

  // 全画像要素の配列
  function getAllImages() {
    return [
      els.imgMouthClosedEyesOpen,
      els.imgMouthClosedEyesClosed,
      els.imgMouthOpenEyesOpen,
      els.imgMouthOpenEyesClosed
    ];
  }

  function applyAvatarState() {
    const targetMouthOpen = mouthOpen;
    const targetEyesOpen = eyesOpen;

    // 変更がなければスキップ
    if (targetMouthOpen === currentState.mouthOpen &&
        targetEyesOpen === currentState.eyesOpen) {
      return;
    }

    const incoming = getTargetImage(targetMouthOpen, targetEyesOpen);
    const allImages = getAllImages();

    // 新しい画像を即座に表示、古い画像は下のレイヤーに配置（ちらつき防止）
    allImages.forEach(img => {
      if (img === incoming) {
        img.style.transition = 'none';
        img.style.opacity = '1';
        img.style.zIndex = '2';
      } else {
        img.style.zIndex = '1';
        img.style.opacity = '0';
      }
    });

    currentState = { mouthOpen: targetMouthOpen, eyesOpen: targetEyesOpen };
  }

  // 瞬きをスケジュール
  function scheduleNextBlink() {
    if (!state.blinkEnabled || !started) return;

    // ランダム間隔を計算
    const intervalMs = (state.blinkIntervalMin +
      Math.random() * (state.blinkIntervalMax - state.blinkIntervalMin)) * 1000;

    blinkTimeoutId = setTimeout(() => {
      performBlink();
    }, intervalMs);
  }

  // 瞬きを実行
  function performBlink() {
    if (!state.blinkEnabled || !started) return;

    eyesOpen = false;
    applyAvatarState();

    // 瞬き終了をスケジュール
    blinkEndTimeoutId = setTimeout(() => {
      eyesOpen = true;
      applyAvatarState();
      scheduleNextBlink();
    }, state.blinkDuration);
  }

  // 瞬きタイマーを停止
  function stopBlinking() {
    if (blinkTimeoutId) {
      clearTimeout(blinkTimeoutId);
      blinkTimeoutId = null;
    }
    if (blinkEndTimeoutId) {
      clearTimeout(blinkEndTimeoutId);
      blinkEndTimeoutId = null;
    }
    eyesOpen = true;
  }

  function getTimeDomainPeak() {
    const n = analyser.fftSize;
    if (analyser.getFloatTimeDomainData) {
      if (!floatData || floatData.length !== n) floatData = new Float32Array(n);
      analyser.getFloatTimeDomainData(floatData);
      // Remove DC offset
      let mean = 0;
      for (let i = 0; i < n; i++) mean += floatData[i];
      mean /= n;
      let peak = 0;
      for (let i = 0; i < n; i++) {
        let v = Math.abs(floatData[i] - mean); // already -1..1
        if (v > peak) peak = v;
      }
      return clamp(peak, 0, 1);
    } else {
      analyser.getByteTimeDomainData(timeData);
      const n2 = timeData.length;
      let mean = 0;
      for (let i = 0; i < n2; i++) mean += (timeData[i] - 128) / 128;
      mean /= n2;
      let peak = 0;
      for (let i = 0; i < n2; i++) {
        let v = (timeData[i] - 128) / 128 - mean;
        v = Math.abs(v);
        if (v > peak) peak = v;
      }
      return clamp(peak, 0, 1);
    }
  }

  // Settings persistence helpers
  const LS_KEY = 'pngtuber-settings-v1';
  function loadSettings(apply = true) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!apply) return s;
      if (typeof s.threshold === 'number') els.threshold.value = Math.round(clamp(s.threshold, 0, 1) * 100);
      if (typeof s.toggleInterval === 'number') els.toggleInterval.value = Math.round(clamp(s.toggleInterval, 0.1, 1.0) * 10);
      if (typeof s.smoothing === 'number') els.smoothing.value = Math.round(clamp(s.smoothing, 0, 0.95) * 100);
      if (typeof s.gain === 'number' && els.gain) els.gain.value = Math.round(clamp(s.gain, 0.5, 6.0) * 100);
      if (typeof s.scalePct === 'number') els.scale.value = clamp(Math.round(s.scalePct), 25, 200);
      if (typeof s.showMeter === 'boolean') els.showMeter.checked = s.showMeter;
      if (typeof s.bgColor === 'string' && els.bgColor) {
        const hx = normalizeHexColor(s.bgColor) || '#0b0f14';
        els.bgColor.value = hx;
      }
      // 瞬き設定の読み込み
      if (typeof s.blinkEnabled === 'boolean') els.blinkEnabled.checked = s.blinkEnabled;
      if (typeof s.blinkIntervalMin === 'number') els.blinkIntervalMin.value = Math.round(clamp(s.blinkIntervalMin, 1.0, 5.0) * 10);
      if (typeof s.blinkIntervalMax === 'number') els.blinkIntervalMax.value = Math.round(clamp(s.blinkIntervalMax, 3.0, 10.0) * 10);
      if (typeof s.blinkDuration === 'number') els.blinkDuration.value = clamp(s.blinkDuration, 50, 300);
      return s;
    } catch (_) {
      return null;
    }
  }

  function saveSettings() {
    try {
      const cfg = {
        threshold: state.threshold,
        toggleInterval: state.toggleInterval,
        smoothing: state.smoothing,
        gain: state.gain,
        scalePct: state.scalePct,
        showMeter: !!els.showMeter.checked,
        // 4画像の選択状態
        imageMouthClosedEyesOpen: selectValueToName(els.imageMouthClosedEyesOpen.value),
        imageMouthClosedEyesClosed: selectValueToName(els.imageMouthClosedEyesClosed.value),
        imageMouthOpenEyesOpen: selectValueToName(els.imageMouthOpenEyesOpen.value),
        imageMouthOpenEyesClosed: selectValueToName(els.imageMouthOpenEyesClosed.value),
        deviceId: state.deviceId,
        bgColor: state.bgColor,
        // 瞬き設定
        blinkEnabled: state.blinkEnabled,
        blinkIntervalMin: state.blinkIntervalMin,
        blinkIntervalMax: state.blinkIntervalMax,
        blinkDuration: state.blinkDuration,
      };
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  function selectValueToName(v) {
    if (!v) return '';
    try { return decodeURIComponent((v[0] === '/' ? v.slice(1) : v)); } catch { return ''; }
  }

  function normalizeHexColor(v) {
    if (typeof v !== 'string') return null;
    const m = v.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(m)) return m;
    return null;
  }

  function updateBgColor() {
    const hex = normalizeHexColor(els.bgColor && els.bgColor.value) || '#0b0f14';
    state.bgColor = hex;
    if (els.bgColorVal) els.bgColorVal.textContent = hex;
    els.avatar.style.background = hex;
    saveSettings();
  }

  // 瞬き設定UIの更新
  function updateBlinkUI() {
    const minVal = parseInt(els.blinkIntervalMin.value, 10) / 10;
    const maxVal = parseInt(els.blinkIntervalMax.value, 10) / 10;
    const duration = parseInt(els.blinkDuration.value, 10);

    state.blinkEnabled = els.blinkEnabled.checked;
    state.blinkIntervalMin = clamp(minVal, 1.0, 5.0);
    state.blinkIntervalMax = clamp(Math.max(maxVal, minVal + 1), 3.0, 10.0);
    state.blinkDuration = clamp(duration, 50, 300);

    els.blinkIntervalMinVal.textContent = state.blinkIntervalMin.toFixed(1);
    els.blinkIntervalMaxVal.textContent = state.blinkIntervalMax.toFixed(1);
    els.blinkDurationVal.textContent = state.blinkDuration;

    // 瞬き機能の有効/無効切り替え時
    if (state.blinkEnabled && started && !blinkTimeoutId) {
      scheduleNextBlink();
    } else if (!state.blinkEnabled) {
      stopBlinking();
    }

    saveSettings();
  }

  // マイクボタンの状態更新
  function updateMicButton(isOn) {
    els.micToggle.classList.toggle('active', isOn);
    els.micIconOn.style.display = isOn ? 'block' : 'none';
    els.micIconOff.style.display = isOn ? 'none' : 'block';
  }

  // 設定パネルのトグル
  function toggleSettings() {
    const isHidden = els.controlsPanel.classList.toggle('hidden');
    els.settingsToggle.classList.toggle('active', !isHidden);
  }

  // Event bindings
  els.settingsToggle.addEventListener('click', toggleSettings);
  els.micToggle.addEventListener('click', () => {
    if (started) stopMic(); else startMic();
  });
  els.toggleBtn.addEventListener('click', () => {
    if (started) stopMic(); else startMic();
  });
  els.refreshBtn.addEventListener('click', fillDevices);
  els.deviceSelect.addEventListener('change', () => { state.deviceId = els.deviceSelect.value; saveSettings(); if (started) { stopMic(); startMic(); } });
  els.threshold.addEventListener('input', updateSlidersUI);
  els.toggleInterval.addEventListener('input', updateSlidersUI);
  els.smoothing.addEventListener('input', updateSlidersUI);
  els.scale.addEventListener('input', updateScale);
  els.gain.addEventListener('input', updateSlidersUI);
  // 4画像選択イベント
  els.imageMouthClosedEyesOpen.addEventListener('change', updateImages);
  els.imageMouthClosedEyesClosed.addEventListener('change', updateImages);
  els.imageMouthOpenEyesOpen.addEventListener('change', updateImages);
  els.imageMouthOpenEyesClosed.addEventListener('change', updateImages);
  els.showMeter.addEventListener('change', () => { updateMeter(smoothVolume); saveSettings(); });
  if (els.bgColor) els.bgColor.addEventListener('input', updateBgColor);
  // 瞬き設定イベント
  els.blinkEnabled.addEventListener('change', updateBlinkUI);
  els.blinkIntervalMin.addEventListener('input', updateBlinkUI);
  els.blinkIntervalMax.addEventListener('input', updateBlinkUI);
  els.blinkDuration.addEventListener('input', updateBlinkUI);

  // Init
  (async function init() {
    const saved = loadSettings(true);
    updateSlidersUI();
    updateScale();
    updateBgColor();
    updateBlinkUI();
    // Try to populate images
    const imgs = await fetchImages();
    if (imgs.length) {
      populateImageSelects(imgs);
      if (saved) {
        // 4画像の選択状態を復元
        const imageKeys = [
          'imageMouthClosedEyesOpen',
          'imageMouthClosedEyesClosed',
          'imageMouthOpenEyesOpen',
          'imageMouthOpenEyesClosed'
        ];
        imageKeys.forEach(key => {
          if (saved[key] && imgs.includes(saved[key])) {
            els[key].value = `/${encodeURIComponent(saved[key])}`;
          }
        });
        updateImages();
      }
    } else {
      els.error.textContent = 'public フォルダ内の画像を検出できませんでした。';
    }
    // Pre-fill device list (labels empty until permission granted)
    await fillDevices();
  })();
})();
