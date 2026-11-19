(function () {
  const DIRECT_FEEDBACK_URL = 'http://192.168.4.1/feedback';
  const POLL_INTERVAL_MS = 150;
  const FETCH_TIMEOUT_MS = 700;
  const LED_KEYS = ['red', 'yellow', 'green_left', 'green_right'];

  let active = false;
  let live = false;
  let timerId = null;
  let lastLedState = null;

  function formatLedLabel(key, value) {
    const cleanName = key.replace('_', ' ').toUpperCase();
    return `${cleanName} · ${value === 1 ? 'ON' : 'OFF'}`;
  }

  function renderPanel(leds, connected) {
    const panel = document.getElementById('prestan-panel');
    if (panel) {
      panel.style.display = active ? 'block' : 'none';
    }

    const connEl = document.getElementById('prestan-connection');
    if (connEl) {
      connEl.textContent = connected ? 'LIVE (ESP32)' : (active ? 'CONNECTING...' : 'STANDBY');
    }

    const idMap = {
      red: 'prestan-red',
      yellow: 'prestan-yellow',
      green_left: 'prestan-green-left',
      green_right: 'prestan-green-right'
    };

    LED_KEYS.forEach((key) => {
      const el = document.getElementById(idMap[key]);
      if (!el) return;
      const val = leds && (leds[key] === 1 || leds[key] === 0) ? leds[key] : 0;
      el.textContent = formatLedLabel(key, val);
      el.classList.toggle('is-on', val === 1);
      el.dataset.state = val === 1 ? 'on' : 'off';
    });
  }

  function normalizeLeds(payload) {
    if (!payload || typeof payload !== 'object') return null;
    for (const key of LED_KEYS) {
      if (typeof payload[key] !== 'number' || (payload[key] !== 0 && payload[key] !== 1)) {
        return null;
      }
    }
    return {
      red: payload.red,
      yellow: payload.yellow,
      green_left: payload.green_left,
      green_right: payload.green_right
    };
  }

  function hasLedChanged(prev, next) {
    if (!prev || !next) return true;
    return LED_KEYS.some((key) => prev[key] !== next[key]);
  }

  async function pollOnce() {
    if (!active) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(DIRECT_FEEDBACK_URL, {
        method: 'GET',
        cache: 'no-store',
        mode: 'cors',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const leds = normalizeLeds(data);
      if (!leds) {
        throw new Error('Invalid JSON structure');
      }

      const wasLive = live;
      live = true;
      renderPanel(leds, true);

      if (!wasLive && typeof window.prestanStudyHook === 'function') {
        window.prestanStudyHook('prestan_connected', {
          source: typeof data.source === 'string' ? data.source : 'esp32_gpio',
          endpoint: DIRECT_FEEDBACK_URL
        });
      }

      if (hasLedChanged(lastLedState, leds) && typeof window.prestanStudyHook === 'function') {
        window.prestanStudyHook('prestan_led_change', {
          leds: { ...leds },
          timestamp_ms: typeof data.timestamp_ms === 'number' ? data.timestamp_ms : null
        });
      }

      lastLedState = { ...leds };

      if (typeof window.prestanStudyHook === 'function') {
        window.prestanStudyHook('prestan_sample', {
          leds: { ...leds },
          timestamp_ms: typeof data.timestamp_ms === 'number' ? data.timestamp_ms : null
        });
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const wasLive = live;
      live = false;
      renderPanel(lastLedState, false);

      if (wasLive && typeof window.prestanStudyHook === 'function') {
        window.prestanStudyHook('prestan_disconnected', {
          reason: err && err.name === 'AbortError' ? 'timeout' : String(err && err.message ? err.message : err)
        });
      }
    }
  }

  function startPolling() {
    stopPolling();
    pollOnce();
    timerId = setInterval(pollOnce, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  window.PRESTAN = {
    setActive(isActive) {
      active = !!isActive;
      if (active) {
        renderPanel(lastLedState, live);
        startPolling();
      } else {
        stopPolling();
        live = false;
        renderPanel(lastLedState, false);
      }
    },
    isLive() {
      return live;
    },
    getEndpoint() {
      return DIRECT_FEEDBACK_URL;
    }
  };
})();
