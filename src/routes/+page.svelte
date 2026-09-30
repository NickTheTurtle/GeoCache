<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { employee } from '$lib/employee.js';
  import { loadLeaflet, addBaseLayer, SF_CENTER } from '$lib/leaflet.js';
  import { escapeHtml, zoneStyle, CHECK_ICON, extractSecret, renderHint, getJson, poll, formatPts, formatDelta } from '$lib/util.js';
  import Celebration from '$lib/Celebration.svelte';
  import BrandIcon from '$lib/BrandIcon.svelte';

  // Reactive UI state
  let currentEmployee = $state(null);
  let menuOpen = $state(false);
  let leaders = $state([]);
  let tab = $state('hunt');

  let zoneModalOpen = $state(false);
  let zoneTitle = $state('');
  let zoneStatusHtml = $state('');
  let zoneHintText = $state('');
  let zoneImageUrl = $state(null);

  let scanOpen = $state(false);
  let scanMsg = $state('Point your camera at a QR code to claim it.');
  let scanMsgClass = $state('muted');
  // Success celebration state (shown after a claim instead of the camera box).
  let scanSuccess = $state(false);
  let scanErr = $state(false);
  let successText = $state('');
  let successConfetti = $state(true);

  // Claim modal (opened from a scanned QR link: /?c=<secret>). Mirrors the
  // scanner modal's look; lets a signed-in employee confirm a claim on the map page.
  let claimOpen = $state(false);
  let claimSecret = $state(null);
  let claimZoneName = $state('');
  let claimView = $state('loading'); // loading | error | signin | claim | already | claimed
  let claimErrMsg = $state('');
  let claiming = $state(false);
  let claimOtherCount = $state(0);
  let claimRequirePresence = $state(false);
  let claimPoints = $state(0);
  let claimFirst = $state(false);

  // Imperative (non-reactive) map state
  let L = null;
  let map = null;
  let mapReady = false;
  let zoneLayers = new Map();
  let meMarker = null;
  let meCircle = null;
  let locating = false;
  let followMe = false;
  let modalMap = null;
  let modalLayer = null;
  let modalMeDot = null;
  let qrScanner = null;
  let mapEl;
  let modalMapEl;

  const unsub = employee.subscribe((v) => {
    currentEmployee = v;
    if (mapReady) restyleZones();
  });
  onDestroy(unsub);

  // A phone can outlive its employee (deleted by an admin, or a game reset). Only a
  // definite "not found" signs it out; a network hiccup leaves it signed in.
  async function verifyEmployee() {
    const e = currentEmployee;
    if (!e) return;
    const res = await fetch(`/api/employees/${encodeURIComponent(e.token)}`).catch(() => null);
    if (res?.status === 404 && currentEmployee?.token === e.token) employee.set(null);
  }

  function signOut() {
    menuOpen = false;
    if (location.search) history.replaceState(null, '', location.pathname);
    employee.set(null);
  }

  // ---------- Zones ----------
  async function loadZones() {
    const zones = await getJson('/api/zones');
    for (const [id, entry] of zoneLayers) {
      if (!zones.find((z) => z.id === id)) {
        map.removeLayer(entry.layer);
        zoneLayers.delete(id);
      }
    }
    for (const z of zones) {
      let entry = zoneLayers.get(z.id);
      if (entry) {
        entry.data = z;
        entry.layer.setStyle(zoneStyle(z, currentEmployee));
      } else {
        const layer = L.polygon(z.polygon, zoneStyle(z, currentEmployee)).addTo(map);
        layer.on('click', () => openZoneModal(zoneLayers.get(z.id).data));
        entry = { layer, data: z };
        zoneLayers.set(z.id, entry);
      }
      const claimed = z.claimedBy.length > 0;
      entry.layer.bindTooltip(
        claimed
          ? `${escapeHtml(z.name)}: ${z.claimedBy.length} claim${z.claimedBy.length > 1 ? 's' : ''}`
          : escapeHtml(z.name),
        { sticky: true }
      );
    }
  }

  function restyleZones() {
    for (const [, entry] of zoneLayers) entry.layer.setStyle(zoneStyle(entry.data, currentEmployee));
  }

  // ---------- Zone modal ----------
  function openZoneModal(z) {
    zoneModalOpen = true;
    zoneTitle = z.name;
    if (z.claimedBy.length) {
      const n = z.claimedBy.length;
      zoneStatusHtml = `<span class="claimed-flag">${CHECK_ICON} Claimed by ${n} employee${n > 1 ? 's' : ''}</span>`;
    } else {
      zoneStatusHtml = `<span class="status">Unclaimed. Find the QR code &amp; scan it!</span>`;
    }
    zoneImageUrl = z.image || null;
    zoneHintText = (z.hint || '').trim() || (zoneImageUrl ? '' : '(blank)');

    if (!modalMap) {
      modalMap = L.map(modalMapEl, { zoomControl: false, attributionControl: false, dragging: true });
      addBaseLayer(L, modalMap, null);
    }
    if (modalLayer) modalMap.removeLayer(modalLayer);
    modalLayer = L.polygon(z.polygon, zoneStyle(z, currentEmployee)).addTo(modalMap);

    setTimeout(() => {
      modalMap.invalidateSize();
      modalMap.fitBounds(modalLayer.getBounds(), { padding: [30, 30], maxZoom: 17 });
      if (modalMeDot) { modalMap.removeLayer(modalMeDot); modalMeDot = null; }
      if (meMarker && modalMap.getBounds().pad(2).contains(meMarker.getLatLng())) {
        modalMeDot = L.circleMarker(meMarker.getLatLng(), {
          radius: 6, color: '#2a7ea3', fillColor: '#2a7ea3', fillOpacity: 1,
        }).addTo(modalMap);
      }
    }, 60);
  }
  function closeZoneModal() { zoneModalOpen = false; }

  // ---------- QR scanner ----------
  // Get the device's current position once (for geofenced/on-site zones).
  function getPosition() {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        reject(new Error('no-geolocation'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos.coords),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
      );
    });
  }

  // POST a claim, optionally including the employee's GPS coords.
  async function postClaim(secret, coords) {
    const body = { secret, employeeToken: currentEmployee.token };
    if (coords) {
      body.lat = coords.latitude;
      body.lng = coords.longitude;
      body.accuracy = coords.accuracy;
    }
    const res = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { res, data: await res.json().catch(() => ({})) };
  }

  // Claim a zone, transparently supplying GPS for geofenced zones: try once,
  // and if the server says it needs a location, fetch it and retry. Returns
  // { res, data }, with data.status possibly 'location-denied' when GPS fails.
  async function claimZoneBySecret(secret) {
    let { res, data } = await postClaim(secret);
    if (data.status === 'needs-location') {
      let coords;
      try {
        coords = await getPosition();
      } catch {
        return { res, data: { status: 'location-denied', zone: data.zone } };
      }
      ({ res, data } = await postClaim(secret, coords));
    }
    return { res, data };
  }

  async function openScan() {
    scanOpen = true;
    scanSuccess = false;
    scanErr = false;
    scanMsg = 'Point your camera at a QR code to claim it.';
    scanMsgClass = 'muted';
    let Html5Qrcode;
    try {
      ({ Html5Qrcode } = await import('html5-qrcode'));
    } catch {
      scanMsg = 'Scanner failed to load. Check your connection and try again.';
      scanMsgClass = 'err';
      scanErr = true;
      return;
    }
    await tick(); // ensure #scanReader is in the DOM (it's hidden in the success view)
    try {
      qrScanner = new Html5Qrcode('scanReader', { verbose: false });
      await qrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        onScanSuccess,
        () => {}
      );
    } catch {
      qrScanner = null; // never started, so there's nothing to stop later
      scanMsg = 'Could not access the camera. Grant permission, or scan the QR with your phone\u2019s camera app.';
      scanMsgClass = 'err';
      scanErr = true;
    }
  }

  async function onScanSuccess(decodedText) {
    const secret = extractSecret(decodedText);
    if (!secret) {
      scanMsg = 'That doesn\u2019t look like a C.A.R.E. QR code.';
      scanMsgClass = 'err';
      return;
    }
    await stopScanner();
    if (!currentEmployee) {
      scanMsg = 'Open your personal link first, then scan to claim.';
      scanMsgClass = 'err';
      scanErr = true;
      return;
    }
    scanMsg = 'Claiming\u2026';
    scanMsgClass = 'status';
    try {
      const { res, data } = await claimZoneBySecret(secret);
      if (res.ok && data.status === 'claimed') {
        celebrate(`Claimed ${data.zone.name} for ${currentEmployee.name}! ${formatDelta(data.points)} pts${data.first ? '. First to solve!' : '.'}`);
        refreshBoard();
      } else if (data.status === 'already-yours') {
        celebrate(`You already claimed ${data.zone.name}.`, false);
      } else if (data.status === 'too-far') {
        scanMsg = 'This zone can only be claimed on-site. You\u2019re not in the right location.';
        scanMsgClass = 'err';
        scanErr = true;
      } else if (data.status === 'location-denied') {
        scanMsg = 'This zone can only be claimed on-site. Turn on location access and try again.';
        scanMsgClass = 'err';
        scanErr = true;
      } else {
        await verifyEmployee(); // "Unknown employee": this phone's employee was removed
        scanMsg = currentEmployee
          ? data.message || 'Could not claim this zone.'
          : 'Open your personal link first, then scan to claim.';
        scanMsgClass = 'err';
        scanErr = true;
      }
    } catch {
      scanMsg = 'Network error. Try again.';
      scanMsgClass = 'err';
      scanErr = true;
    }
  }

  function stopScanner() {
    if (!qrScanner) return Promise.resolve();
    const s = qrScanner;
    qrScanner = null;
    // stop() throws synchronously if the camera never started; keep that inside the promise.
    return Promise.resolve().then(() => s.stop()).then(() => s.clear()).catch(() => {});
  }
  function closeScan() { scanOpen = false; scanSuccess = false; scanErr = false; stopScanner(); }

  // Flip the modal into its success view. Confetti fires only for a fresh claim.
  function celebrate(text, confettiOn = true) {
    successText = text;
    successConfetti = confettiOn;
    scanSuccess = true;
  }

  // ---------- Location ----------
  function addLocateControl() {
    const LocateControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const wrap = L.DomUtil.create('div', 'leaflet-bar');
        const btn = L.DomUtil.create('a', 'locate-btn', wrap);
        btn.href = '#';
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
        btn.title = 'Show my location';
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', 'Show my location');
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.on(btn, 'click', (e) => { L.DomEvent.preventDefault(e); toggleLocate(btn); });
        L.DomEvent.on(btn, 'keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLocate(btn); }
        });
        return wrap;
      },
    });
    map.addControl(new LocateControl());
    map.on('locationfound', onLocationFound);
    map.on('locationerror', (e) => {
      locating = false;
      const btn = document.querySelector('.locate-btn');
      if (btn) btn.classList.remove('active');
      map.stopLocate();
      alert('Could not get your location: ' + e.message);
    });
  }

  function toggleLocate(btn) {
    if (!locating) {
      locating = true;
      followMe = true;
      btn.classList.add('active');
      map.locate({ watch: true, enableHighAccuracy: true, setView: false, maxZoom: 17 });
    } else {
      followMe = true;
      if (meMarker) map.setView(meMarker.getLatLng(), Math.max(map.getZoom(), 16));
    }
  }

  function onLocationFound(e) {
    const radius = Math.min(e.accuracy || 30, 200);
    if (!meMarker) {
      const icon = L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] });
      meMarker = L.marker(e.latlng, { icon, zIndexOffset: 1000 }).addTo(map).bindTooltip('You are here');
      meCircle = L.circle(e.latlng, {
        radius, color: '#2a7ea3', weight: 1, fillColor: '#2a7ea3', fillOpacity: 0.12,
      }).addTo(map);
    } else {
      meMarker.setLatLng(e.latlng);
      meCircle.setLatLng(e.latlng).setRadius(radius);
    }
    if (followMe) {
      map.setView(e.latlng, Math.max(map.getZoom(), 16));
      followMe = false;
    }
  }

  // ---------- Leaderboard ----------
  // Refresh the map and leaderboard after a claim; the 15s poll retries on failure.
  const refreshBoard = () => Promise.all([loadZones(), loadLeaderboard()]).catch(() => {});
  async function loadLeaderboard() {
    leaders = await getJson('/api/leaderboard');
  }

  // ---------- Tabs ----------
  function setTab(t) {
    tab = t;
    document.body.classList.toggle('show-board', t === 'board');
    if (map) map.invalidateSize();
  }

  // ---------- URL employee adoption ----------
  async function adoptEmployeeFromUrl() {
    const params = new URLSearchParams(location.search);
    const token = params.get('g');
    if (!token) return;
    try {
      const g = await fetch(`/api/employees/${encodeURIComponent(token)}`).then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      });
      employee.set(g);
    } catch {
      /* ignore invalid token */
    }
    history.replaceState({}, '', location.pathname);
  }

  // ---------- Claim modal (from a scanned QR link) ----------
  async function openClaim(secret) {
    claimSecret = secret;
    claimOpen = true;
    claimView = 'loading';
    claimErrMsg = '';
    claiming = false;
    try {
      const res = await fetch(`/api/claim/${encodeURIComponent(secret)}`);
      if (!res.ok) throw new Error();
      const z = await res.json();
      claimZoneName = z.name;
      claimRequirePresence = !!z.requirePresence;
      const claimers = z.claimedBy || [];
      claimOtherCount = claimers.filter((c) => !currentEmployee || c.id !== currentEmployee.id).length;
      if (currentEmployee && claimers.some((c) => c.id === currentEmployee.id)) claimView = 'already';
      else if (!currentEmployee) claimView = 'signin';
      else claimView = 'claim';
    } catch {
      claimView = 'error';
    }
  }

  function closeClaim() {
    claimOpen = false;
    if (location.search) history.replaceState(null, '', location.pathname);
  }

  async function doClaimFromModal() {
    claimErrMsg = '';
    claiming = true;
    try {
      const { res, data } = await claimZoneBySecret(claimSecret);
      if (res.ok && data.status === 'claimed') {
        claimPoints = data.points;
        claimFirst = data.first;
        claimView = 'claimed';
        refreshBoard();
      } else if (data.status === 'already-yours') {
        claimView = 'already';
      } else if (data.status === 'too-far') {
        claimErrMsg = `You\u2019re about ${data.distance}m away. You have to be on-site to claim this zone, so get closer and try again.`;
        claiming = false;
      } else if (data.status === 'location-denied') {
        claimErrMsg = 'This zone can only be claimed on-site. Turn on location access and try again.';
        claiming = false;
      } else {
        await verifyEmployee(); // "Unknown employee": this phone's employee was removed
        if (currentEmployee) claimErrMsg = data.message || 'Could not claim this zone.';
        else claimView = 'signin';
        claiming = false;
      }
    } catch {
      claimErrMsg = 'Network error. Try again.';
      claiming = false;
    }
  }
  function onKeydown(e) {
    if (e.key === 'Escape') { closeZoneModal(); closeScan(); closeClaim(); menuOpen = false; }
  }
  function onDocClick() { menuOpen = false; }

  let stopPolling;
  onMount(async () => {
    // Listen before any awaits: the claim modal can open right away, and Escape
    // should close it without waiting for the map and zones to load.
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('click', onDocClick);
    const params = new URLSearchParams(location.search);
    const claimParam = params.get('c');
    if (params.has('g')) await adoptEmployeeFromUrl();
    else await verifyEmployee(); // before the claim popup decides what to offer
    if (claimParam) openClaim(claimParam); // pop the claim modal (parallel with map init)
    L = await loadLeaflet();

    const cfg = await getJson('/api/config');
    const b = cfg.sfBounds;
    const bounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);

    map = L.map(mapEl, { maxBounds: bounds, maxBoundsViscosity: 1.0, zoomControl: true }).setView(SF_CENTER, 12);
    addBaseLayer(L, map);
    map.fitBounds(bounds);
    const sfZoom = map.getZoom();
    map.setMinZoom(sfZoom);

    addLocateControl();
    mapReady = true;

    await loadZones();
    // Whole-SF stays the zoom-out limit; start at a fixed absolute zoom so every
    // device (desktop and mobile) opens at the same map scale, centered on the zones.
    const START_ZOOM = (typeof window !== 'undefined' && window.innerWidth < 760) ? 12 : 13;
    const startZoom = Math.max(START_ZOOM, sfZoom);
    const center = zoneLayers.size
      ? L.featureGroup([...zoneLayers.values()].map((e) => e.layer)).getBounds().getCenter()
      : L.latLng(SF_CENTER);
    const applyStart = () => { map.invalidateSize(); map.setView(center, startZoom, { animate: false }); };
    applyStart();
    // Re-apply after layout settles (mobile browsers finalize viewport height late).
    setTimeout(applyStart, 300);
    await loadLeaderboard();
    stopPolling = poll(() => Promise.all([loadZones(), loadLeaderboard(), verifyEmployee()]), 15000);
  });

  onDestroy(() => {
    stopPolling?.();
    stopScanner();
    if (map) map.stopLocate(); // stop the geolocation watch started by toggleLocate
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('click', onDocClick);
    }
  });
</script>

<svelte:head>
  <title>C.A.R.E.</title>
</svelte:head>

<div class="topbar">
  <div class="brand">
    <h1><BrandIcon /> C.A.R.E.</h1>
  </div>
  <div class="spacer"></div>
  {#if currentEmployee}
    <div class="employee-menu signed-in">
      <button
        class="badge"
        type="button"
        aria-haspopup="true"
        aria-expanded={menuOpen}
        onclick={(e) => { e.stopPropagation(); menuOpen = !menuOpen; }}
      >
        Employee: <strong>{currentEmployee.name}</strong><span class="caret" aria-hidden="true"></span>
      </button>
      <div class="employee-dropdown" role="menu" hidden={!menuOpen}>
        <button type="button" role="menuitem" onclick={signOut}>Sign out</button>
      </div>
    </div>
  {/if}
</div>

<div class="layout">
  <div id="map" bind:this={mapEl}>
    <button class="scan-fab" type="button" onclick={openScan}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/></svg>
      <span>Scan</span>
    </button>
  </div>
  <aside class="sidebar">
    <div class="panel">
      <div class="card">
        <h2><svg class="h2-ico" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3M8 21h8M12 17v4"/></svg> Leaderboard</h2>
        <ul class="leaderboard">
          {#if leaders.length === 0}
            <li class="muted">No employees yet.</li>
          {:else}
            {#each leaders as r, i}
              <li>
                <span class="rank">{i + 1}</span>
                <span class="lname">{r.name}</span>
                <span class="points">{formatPts(r.points)}</span>
              </li>
            {/each}
          {/if}
        </ul>
      </div>
    </div>
  </aside>
</div>

<nav class="tabbar">
  <button class="tab" class:active={tab === 'hunt'} onclick={() => setTab('hunt')}>
    <svg class="tab-ico" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/></svg>
    <span class="tab-lbl">Map</span>
  </button>
  <button class="tab" class:active={tab === 'board'} onclick={() => setTab('board')}>
    <svg class="tab-ico" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3M8 21h8M12 17v4"/></svg>
    <span class="tab-lbl">Leaderboard</span>
  </button>
</nav>

<!-- Zone hint modal -->
<div class="modal-overlay" role="presentation" style:display={zoneModalOpen ? 'flex' : 'none'} onclick={(e) => { if (e.currentTarget === e.target) closeZoneModal(); }}>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="zoneModalTitle">
    <button class="modal-close" aria-label="Close" onclick={closeZoneModal}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="modal-map" bind:this={modalMapEl}></div>
    <div class="modal-body">
      <h2 id="zoneModalTitle">{zoneTitle}</h2>
      <div class="popup-status">{@html zoneStatusHtml}</div>
      {#if zoneHintText}
        <div class="popup-hint">{@html renderHint(zoneHintText)}</div>
      {/if}
      {#if zoneImageUrl}
        <img class="hint-img" src={zoneImageUrl} alt="Hint" />
      {/if}
    </div>
  </div>
</div>

<!-- QR scanner modal -->
<div class="modal-overlay" role="presentation" style:display={scanOpen ? 'flex' : 'none'} onclick={(e) => { if (e.currentTarget === e.target) closeScan(); }}>
  <div class="modal admin-modal" role="dialog" aria-modal="true" aria-labelledby="scanTitle">
    <button class="modal-close" aria-label="Close" onclick={closeScan}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="modal-body">
      <h2 id="scanTitle">Scan a QR code</h2>
      {#if scanSuccess}
        <Celebration text={successText} confettiOn={successConfetti}>
          <div class="success-actions">
            <button onclick={() => { closeScan(); setTab('board'); }}>See leaderboard</button>
            <button class="ghost" onclick={openScan}>Scan another</button>
          </div>
        </Celebration>
      {:else}
        {#if scanErr}
          <div class="scan-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 2l20 20"/><path d="M9.5 4h5l1.5 2H20a2 2 0 0 1 2 2v9.5"/><path d="M4.5 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h13"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>
            </svg>
          </div>
        {:else}
          <div id="scanReader" class="scan-reader"></div>
        {/if}
        <p class="{scanMsgClass} scan-msg">{scanMsg}</p>
        {#if scanErr}
          <div class="success-actions scan-actions">
            <button onclick={openScan}>Try again</button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
</div>

<!-- Claim modal (opened from a scanned QR link: /?c=<secret>) -->
<div class="modal-overlay" role="presentation" style:display={claimOpen ? 'flex' : 'none'} onclick={(e) => { if (e.currentTarget === e.target) closeClaim(); }}>
  <div class="modal admin-modal" role="dialog" aria-modal="true" aria-labelledby="claimTitle">
    <button class="modal-close" aria-label="Close" onclick={closeClaim}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="modal-body">
      <h2 id="claimTitle">{claimView === 'loading' || claimView === 'error' ? 'Claim a zone' : claimZoneName}</h2>
      {#if claimView === 'loading'}
        <p class="muted">Loading…</p>
      {:else if claimView === 'error'}
        <p class="err">We couldn’t find a zone for that QR code.</p>
      {:else if claimView === 'signin'}
        <p>To claim <strong>{claimZoneName}</strong>, open the personal link you were sent, then scan again.</p>
        <p class="muted modal-note">Don’t have a link? Ask to be added as an employee.</p>
      {:else if claimView === 'claim'}
        <p>Claim <strong>{claimZoneName}</strong> for <strong>{currentEmployee?.name}</strong> and score points. First to solve earns a bonus!</p>
        {#if claimRequirePresence}<p class="muted modal-msg">📍 On-site only: you must be at the spot. We'll check your location when you claim.</p>{/if}
        <div class="success-actions claim-actions">
          <button onclick={doClaimFromModal} disabled={claiming}>{claiming ? 'Claiming…' : 'Claim this zone'}</button>
        </div>
        {#if claimErrMsg}<p class="err modal-msg">{claimErrMsg}</p>{/if}
        {#if claimOtherCount}<p class="muted modal-msg">Also claimed by {claimOtherCount} other {claimOtherCount === 1 ? 'employee' : 'employees'}.</p>{/if}
      {:else if claimView === 'already'}
        <Celebration text={`You already claimed ${claimZoneName}.`} confettiOn={false}>
          {#if claimOtherCount}<p class="muted">Also claimed by {claimOtherCount} other {claimOtherCount === 1 ? 'employee' : 'employees'}.</p>{/if}
          <div class="success-actions">
            <button onclick={() => { closeClaim(); setTab('board'); }}>See leaderboard</button>
            <button class="ghost" onclick={closeClaim}>Close</button>
          </div>
        </Celebration>
      {:else if claimView === 'claimed'}
        <Celebration text={`Claimed ${claimZoneName} for ${currentEmployee?.name}! ${formatDelta(claimPoints)} pts${claimFirst ? '. First to solve!' : '.'}`}>
          <div class="success-actions">
            <button onclick={() => { closeClaim(); setTab('board'); }}>See leaderboard</button>
            <button class="ghost" onclick={closeClaim}>Close</button>
          </div>
        </Celebration>
      {/if}
    </div>
  </div>
</div>
