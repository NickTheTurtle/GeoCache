<script>
  import { onMount, onDestroy } from 'svelte';
  import { loadLeaflet, addBaseLayer, SF_CENTER } from '$lib/leaflet.js';

  const PW_KEY = 'geocache_admin_pw';

  // Auth / view state
  let adminPw = $state('');
  let imgToken = $state('');
  let loggedIn = $state(false);
  let pwInput = $state('');
  let loginErr = $state('');
  let adminTab = $state('zones');

  // Data
  let zones = $state([]);
  let crews = $state([]);
  let claimSel = $state({});

  // Zone form
  let zName = $state('');
  let zHint = $state('');
  let editingId = $state(null);
  let formErr = $state('');
  let ptCount = $state(0);
  let imageData = $state(null);
  let imagePreview = $state(null);
  let removeImage = $state(false);
  let zImgInput = $state();

  // Crew form
  let grpName = $state('');
  let grpErr = $state('');

  // Import / export zones
  let importReplace = $state(false);
  let importErr = $state('');
  let importInput = $state();
  let importing = $state(false);

  // Modals
  let resetOpen = $state(false);
  let confirmOpen = $state(false);
  let confirmTitle = $state('Confirm');
  let confirmMsg = $state('');
  let confirmOkLabel = $state('Delete');
  let confirmResolver = null;

  let toasts = $state([]);

  // Imperative map state
  let L = null;
  let map = null;
  let draftPoints = [];
  let draftMarkers = [];
  let draftPolygon = null;
  let zoneLayers = new Map();
  let mapEl = $state();
  let syncInterval = null;

  function authHeaders(extra = {}) {
    return { 'x-admin-password': adminPw, ...extra };
  }

  function toast(msg) {
    const id = Math.random();
    toasts = [...toasts, { id, msg }];
    setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); }, 2500);
  }

  const crewLink = (token) => `${location.origin}/?g=${token}`;

  // ---------- Login ----------
  async function doLogin() {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwInput }),
    });
    if (!res.ok) { loginErr = 'Wrong password.'; return; }
    adminPw = pwInput;
    sessionStorage.setItem(PW_KEY, adminPw);
    startApp();
  }

  async function startApp() {
    loggedIn = true;
    // Signed token for QR <img>/<a> URLs, so the password stays out of the URL.
    imgToken = await fetch('/api/admin/token', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => d.token)
      .catch(() => '');
    if (!map) await initMap();
    loadZones(); // also refreshes crews
    // Poll so claims/crews made elsewhere (e.g. a crew scanning a QR) show up
    // without a manual refresh.
    if (!syncInterval) syncInterval = setInterval(() => loadZones(), 15000);
  }

  async function initMap() {
    L = await loadLeaflet();
    map = L.map(mapEl).setView(SF_CENTER, 12);
    addBaseLayer(L, map);
    map.on('click', (e) => addVertex(e.latlng));
  }

  function addVertex(latlng) {
    const icon = L.divIcon({ className: 'vtx', iconSize: [14, 14], iconAnchor: [7, 7] });
    const m = L.marker(latlng, { icon, draggable: true, keyboard: false }).addTo(map);
    draftPoints.push([latlng.lat, latlng.lng]);
    draftMarkers.push(m);
    m.on('drag', () => {
      const i = draftMarkers.indexOf(m);
      if (i > -1) {
        const ll = m.getLatLng();
        draftPoints[i] = [ll.lat, ll.lng];
        redrawDraft();
      }
    });
    m.on('contextmenu', (e) => {
      L.DomEvent.stop(e);
      const i = draftMarkers.indexOf(m);
      if (i > -1 && draftPoints.length > 3) {
        draftPoints.splice(i, 1);
        draftMarkers.splice(i, 1);
        map.removeLayer(m);
        redrawDraft();
      }
    });
    redrawDraft();
  }

  function redrawDraft() {
    if (draftPolygon) { map.removeLayer(draftPolygon); draftPolygon = null; }
    if (draftPoints.length >= 2) {
      draftPolygon = L.polygon(draftPoints, {
        color: '#b0863c', weight: 2, fillColor: '#b0863c', fillOpacity: 0.15, dashArray: '5,5',
      }).addTo(map);
    }
    ptCount = draftPoints.length;
  }

  function undoPoint() {
    draftPoints.pop();
    const m = draftMarkers.pop();
    if (m) map.removeLayer(m);
    redrawDraft();
  }

  function clearDraft() {
    draftPoints = [];
    draftMarkers.forEach((m) => map.removeLayer(m));
    draftMarkers = [];
    redrawDraft();
  }

  // ---------- Crews ----------
  async function loadCrews() {
    crews = await fetch('/api/crews', { headers: authHeaders() }).then((r) => r.json());
  }

  async function createCrewAdmin() {
    grpErr = '';
    const name = grpName.trim();
    if (!name) { grpErr = 'Enter a crew name.'; return; }
    const res = await fetch('/api/crews', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) { grpErr = data.message || 'Failed to create crew.'; return; }
    grpName = '';
    toast('Crew created');
    loadCrews();
  }

  function copyCrewLink(token) {
    navigator.clipboard.writeText(crewLink(token)).then(() => toast('Personal link copied'));
  }

  // ---------- Zones ----------
  async function loadZones() {
    const [zList, cList] = await Promise.all([
      fetch('/api/admin/zones', { headers: authHeaders() }).then((r) => r.json()),
      fetch('/api/crews', { headers: authHeaders() }).then((r) => r.json()),
    ]);
    crews = cList;
    zones = zList;

    // Diff the saved-zone layers instead of wiping them, so the 15s poll
    // doesn't flicker the map.
    const seen = new Set();
    for (const z of zones) {
      seen.add(z.id);
      let layer = zoneLayers.get(z.id);
      if (layer) {
        layer.setLatLngs(z.polygon);
        layer.setTooltipContent(z.name);
      } else {
        layer = L.polygon(z.polygon, {
          color: '#123a5c', weight: 2, fillColor: '#123a5c', fillOpacity: 0.12,
        }).addTo(map);
        layer.bindTooltip(z.name);
        zoneLayers.set(z.id, layer);
      }
    }
    for (const [id, layer] of zoneLayers) {
      if (!seen.has(id)) { map.removeLayer(layer); zoneLayers.delete(id); }
    }
  }

  function availableCrews(z) {
    const claimedIds = new Set((z.claimedBy || []).map((c) => c.id));
    return crews.filter((c) => !claimedIds.has(c.id));
  }

  async function claimZoneFor(zoneId) {
    const crewId = Number(claimSel[zoneId]);
    if (!crewId) return;
    const res = await fetch(`/api/admin/zones/${zoneId}/claim`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ crewId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast(data.message || 'Claim failed'); return; }
    toast(data.status === 'already-yours' ? 'Crew already claimed it' : 'Zone claimed');
    loadZones();
  }

  async function unclaimZoneFor(zoneId, crewId) {
    const res = await fetch(`/api/admin/zones/${zoneId}/unclaim`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ crewId }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast(d.message || 'Failed'); return; }
    toast('Claim removed');
    loadZones();
  }

  function onImagePick(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { formErr = 'Please choose an image file.'; return; }
    if (file.size > 4 * 1024 * 1024) { formErr = 'Image is too large (max 4MB).'; return; }
    const reader = new FileReader();
    reader.onload = () => {
      imageData = reader.result;
      imagePreview = reader.result;
      removeImage = false;
    };
    reader.readAsDataURL(file);
  }

  function clearImage() {
    imageData = null;
    imagePreview = null;
    removeImage = true;
    if (zImgInput) zImgInput.value = '';
  }

  async function saveZone() {
    formErr = '';
    const name = zName.trim();
    const hint = zHint.trim();
    if (!name) { formErr = 'Enter a zone name.'; return; }
    if (draftPoints.length < 3) { formErr = 'Draw at least 3 points on the map.'; return; }
    const payload = { name, hint, polygon: draftPoints };
    if (imageData) payload.imageData = imageData;
    if (removeImage && !imageData) payload.removeImage = true;
    const url = editingId ? `/api/admin/zones/${editingId}` : '/api/admin/zones';
    const method = editingId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { formErr = data.message || 'Save failed.'; return; }
    toast(editingId ? 'Zone updated' : 'Zone created');
    resetForm();
    clearDraft();
    loadZones();
  }

  function editZone(id) {
    const z = zones.find((x) => x.id === id);
    if (!z) return;
    editingId = id;
    zName = z.name;
    zHint = z.hint || '';
    imageData = null;
    imagePreview = z.image || null;
    removeImage = false;
    if (zImgInput) zImgInput.value = '';
    clearDraft();
    z.polygon.forEach((p) => addVertex(L.latLng(p[0], p[1])));
    map.fitBounds(L.polygon(draftPoints).getBounds(), { padding: [40, 40] });
  }

  async function deleteZone(id, name) {
    const ok = await customConfirm({
      title: 'Delete zone',
      message: `Delete "${name}"? This also removes its claims and QR code.`,
      okLabel: 'Delete zone',
    });
    if (!ok) return;
    const res = await fetch(`/api/admin/zones/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (res.ok) { toast('Zone deleted'); loadZones(); }
  }

  function cancelEdit() { resetForm(); clearDraft(); }

  function resetForm() {
    editingId = null;
    zName = '';
    zHint = '';
    formErr = '';
    imageData = null;
    imagePreview = null;
    removeImage = false;
    if (zImgInput) zImgInput.value = '';
  }

  // ---------- Import / export zones ----------
  const exportUrl = () => `/api/admin/zones/export?t=${encodeURIComponent(imgToken)}`;

  async function onZonesFilePick(e) {
    importErr = '';
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      importErr = 'That file is not valid JSON.';
      if (importInput) importInput.value = '';
      return;
    }
    const list = Array.isArray(parsed) ? parsed : parsed?.zones;
    if (!Array.isArray(list) || list.length === 0) {
      importErr = 'No zones found in that file.';
      if (importInput) importInput.value = '';
      return;
    }

    const n = list.length;
    const ok = await customConfirm({
      title: importReplace ? 'Replace all zones' : 'Import zones',
      message: importReplace
        ? `This deletes every existing zone (and its claims), then imports ${n} zone${n === 1 ? '' : 's'}. Continue?`
        : `Add ${n} zone${n === 1 ? '' : 's'} to the game?`,
      okLabel: importReplace ? 'Replace all' : 'Import',
    });
    if (!ok) { if (importInput) importInput.value = ''; return; }

    importing = true;
    try {
      const res = await fetch('/api/admin/zones/import', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ zones: list, replace: importReplace }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { importErr = data.message || 'Import failed.'; return; }
      toast(`Imported ${data.imported} zone${data.imported === 1 ? '' : 's'}`);
      if (map) { map.setView(SF_CENTER, 12); }
      loadZones();
    } finally {
      importing = false;
      if (importInput) importInput.value = '';
    }
  }

  // ---------- Reset + confirm modals ----------
  function customConfirm({ title = 'Confirm', message = '', okLabel = 'Delete' }) {
    return new Promise((resolve) => {
      confirmResolver = resolve;
      confirmTitle = title;
      confirmMsg = message;
      confirmOkLabel = okLabel;
      confirmOpen = true;
    });
  }
  function closeConfirm(result) {
    confirmOpen = false;
    if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
  }

  async function doReset(keepZones) {
    resetOpen = false;
    const res = await fetch('/api/admin/reset', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ keepZones }),
    });
    if (res.ok) {
      toast(keepZones ? 'Game reset, zones kept' : 'Game reset, zones deleted');
      resetForm();
      clearDraft();
      loadZones(); // also refreshes crews
    } else {
      toast('Reset failed');
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { resetOpen = false; closeConfirm(false); }
  }

  onMount(async () => {
    adminPw = sessionStorage.getItem(PW_KEY) || '';
    if (adminPw) {
      const res = await fetch('/api/admin/zones', { headers: authHeaders() });
      if (res.ok) await startApp();
    }
    window.addEventListener('keydown', onKeydown);
  });
  onDestroy(() => {
    if (syncInterval) clearInterval(syncInterval);
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown);
  });
</script>

<svelte:head>
  <title>Admin · GeoCache SF</title>
</svelte:head>

<div class="topbar">
  <div class="brand">
    <h1><svg class="brand-ico" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v13M5.5 12A6.5 6.5 0 0 0 12 20a6.5 6.5 0 0 0 6.5-8M5.5 12H3l1.6-2M18.5 12H21l-1.6-2"/></svg> GeoCache SF Admin</h1>
    <span class="tagline">Chart the zones · Mint the QR codes</span>
  </div>
  <div class="spacer"></div>
  <a href="/"><button class="secondary">Map</button></a>
</div>

{#if !loggedIn}
  <div class="center-wrap">
    <div class="card">
      <h2>Admin login</h2>
      <label for="pw">Admin password</label>
      <input id="pw" type="password" placeholder="Password" bind:value={pwInput}
        onkeydown={(e) => { if (e.key === 'Enter') doLogin(); }} />
      <div class="btn-row"><button onclick={doLogin}>Log in</button></div>
      <div class="err">{loginErr}</div>
    </div>
  </div>
{:else}
  <div class="admin-grid">
    <div class="admin-panel">
      <div class="admin-tabs" role="tablist">
        <button class="admin-tab" class:active={adminTab === 'zones'} role="tab" aria-selected={adminTab === 'zones'} onclick={() => (adminTab = 'zones')}>Zones</button>
        <button class="admin-tab" class:active={adminTab === 'crews'} role="tab" aria-selected={adminTab === 'crews'} onclick={() => (adminTab = 'crews')}>Crews</button>
        <button class="admin-tab" class:active={adminTab === 'data'} role="tab" aria-selected={adminTab === 'data'} onclick={() => (adminTab = 'data')}>Data</button>
      </div>

      {#if adminTab === 'zones'}
      <div class="card">
        <h2 class="form-title">
          {#if editingId}
            <button type="button" class="back-btn" aria-label="Cancel edit" title="Cancel edit" onclick={cancelEdit}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5 8 12l7 7"/></svg></button>
          {/if}
          <span>{editingId ? `Edit: ${zName}` : 'New zone'}</span>
        </h2>
        <label for="zName">Zone name</label>
        <input id="zName" placeholder="Golden Gate Park West" maxlength="60" bind:value={zName} />
        <label for="zHint">Hint</label>
        <textarea id="zHint" rows="3" placeholder="Look near the bench facing the windmill…" bind:value={zHint}></textarea>
        <label for="zImg">Hint image (optional)</label>
        <input id="zImg" type="file" accept="image/*" bind:this={zImgInput} onchange={onImagePick} />
        {#if imagePreview}
          <div class="img-preview">
            <img src={imagePreview} alt="Hint preview" />
            <button type="button" class="secondary" onclick={clearImage}>Remove image</button>
          </div>
        {/if}
        <div class="pt-count-row"><span class="pill">{ptCount} points</span></div>
        <div class="form-actions">
          <button class="secondary" type="button" onclick={undoPoint}>Undo</button>
          <button class="secondary" type="button" onclick={clearDraft}>Clear</button>
          <button onclick={saveZone}>Save zone</button>
        </div>
        <div class="err">{formErr}</div>
      </div>

      <div class="card">
        <h2>Zones</h2>
        <div>
          {#if zones.length === 0}
            <p class="muted">No zones yet. Draw one on the map!</p>
          {:else}
            {#each zones as z}
              <div class="zone-item">
                <strong>{z.name}</strong>
                <div class="row">
                  <img class="qr-thumb" src={`/api/admin/zones/${z.id}/qr?t=${encodeURIComponent(imgToken)}`} alt={`QR code for ${z.name}`} />
                  <div class="qr-actions">
                    <a href={`/api/admin/zones/${z.id}/qr?download=1&t=${encodeURIComponent(imgToken)}`} download>
                      <button class="secondary" type="button">Download QR</button>
                    </a>
                    <button class="secondary" type="button" onclick={() => editZone(z.id)}>Edit</button>
                    <button class="danger" type="button" onclick={() => deleteZone(z.id, z.name)}>Delete</button>
                  </div>
                </div>
                <div class="claim-section">
                  <div class="claim-chips">
                    {#if (z.claimedBy || []).length}
                      {#each z.claimedBy as c}
                        <span class="claim-chip">{c.name}<button class="chip-remove" type="button" title="Remove claim" onclick={() => unclaimZoneFor(z.id, c.id)}>Remove</button></span>
                      {/each}
                    {:else}
                      <span class="muted claim-note">No claims yet</span>
                    {/if}
                  </div>
                  {#if crews.length === 0}
                    <div class="muted claim-note">Create a crew to assign claims.</div>
                  {:else if availableCrews(z).length === 0}
                    <div class="muted claim-note">All crews have claimed this zone.</div>
                  {:else}
                    <div class="claim-row">
                      <select bind:value={claimSel[z.id]} aria-label={`Choose a crew to claim ${z.name}`}>
                        {#each availableCrews(z) as c}<option value={c.id}>{c.name}</option>{/each}
                      </select>
                      <button class="secondary" type="button" onclick={() => claimZoneFor(z.id)}>Claim</button>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
      {/if}

      {#if adminTab === 'crews'}
      <div class="card">
        <h2>Crews</h2>
        <label for="grpName">Crew name</label>
        <input id="grpName" placeholder="The Fog Chasers" maxlength="40" bind:value={grpName} />
        <div class="btn-row"><button type="button" onclick={createCrewAdmin}>Create crew</button></div>
        <div class="err">{grpErr}</div>
        <div class="crew-list">
          {#if crews.length === 0}
            <p class="muted">No crews yet.</p>
          {:else}
            {#each crews as c}
              <div class="zone-item">
                <strong>{c.name}</strong>
                <div class="muted crew-link">{crewLink(c.token)}</div>
                <div class="row">
                  <button class="secondary" type="button" onclick={() => copyCrewLink(c.token)}>Copy link</button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
      {/if}

      {#if adminTab === 'data'}
      <div class="card">
        <h2>Import zones</h2>
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={importReplace} />
          <span>Replace existing zones</span>
        </label>
        <label for="zonesFile">Zones file (.json)</label>
        <input id="zonesFile" type="file" accept="application/json,.json" bind:this={importInput} onchange={onZonesFilePick} disabled={importing} />
        <div class="err">{importErr}</div>
      </div>

      <div class="card">
        <h2>Export zones</h2>
        <div class="form-actions">
          <a href={exportUrl()} download>
            <button class="secondary" type="button">Export zones</button>
          </a>
        </div>
      </div>

      <div class="card card-danger">
        <h2>Reset</h2>
        <button class="danger" type="button" onclick={() => (resetOpen = true)}>Reset game…</button>
      </div>
      {/if}
    </div>
    <div id="map" bind:this={mapEl}></div>
  </div>
{/if}

<!-- Reset confirmation modal -->
<div class="modal-overlay" role="presentation" style:display={resetOpen ? 'flex' : 'none'} onclick={(e) => { if (e.currentTarget === e.target) resetOpen = false; }}>
  <div class="modal admin-modal">
    <button class="modal-close" aria-label="Close" onclick={() => (resetOpen = false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="modal-body">
      <h2>Reset game</h2>
      <p>This permanently clears all crews, claims and leaderboard points. What should happen to the zones and their QR codes?</p>
      <div class="modal-actions">
        <button class="secondary" type="button" onclick={() => doReset(true)}>Keep zones &amp; QR codes</button>
        <button class="danger" type="button" onclick={() => doReset(false)}>Delete zones</button>
      </div>
      <button class="link-btn" type="button" onclick={() => (resetOpen = false)}>Cancel</button>
    </div>
  </div>
</div>

<!-- Generic confirm modal -->
<div class="modal-overlay" role="presentation" style:display={confirmOpen ? 'flex' : 'none'} onclick={(e) => { if (e.currentTarget === e.target) closeConfirm(false); }}>
  <div class="modal admin-modal">
    <button class="modal-close" aria-label="Close" onclick={() => closeConfirm(false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="modal-body">
      <h2>{confirmTitle}</h2>
      <p>{confirmMsg}</p>
      <div class="modal-actions">
        <button class="danger" type="button" onclick={() => closeConfirm(true)}>{confirmOkLabel}</button>
      </div>
      <button class="link-btn" type="button" onclick={() => closeConfirm(false)}>Cancel</button>
    </div>
  </div>
</div>

{#each toasts as t (t.id)}
  <div class="toast">{t.msg}</div>
{/each}
