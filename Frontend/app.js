'use strict';
const API = 'http://localhost:4000/api';
const PAYMENT = { 1:'Credit Card', 2:'Cash', 3:'No Charge', 4:'Dispute' };
const BOROUGH_COLOR = { Manhattan:'#00d4ff', Brooklyn:'#f59e0b', Queens:'#10b981', Bronx:'#f43f5e', 'Staten Island':'#8b5cf6' };

let charts = {}, page = 1, filters = {};
let zoneById = new Map();

// ── Utils ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt  = (n, d=0) => n == null ? '—' : Number(n).toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d});
const fmtD = n => n == null ? '—' : '$' + fmt(n, 2);

function buildQ(extra = {}) {
  return new URLSearchParams(Object.fromEntries(
    Object.entries({ ...filters, ...extra }).filter(([,v]) => v !== '' && v != null)
  )).toString();
}

async function get(path, q = '') {
  try {
    const r = await fetch(`${API}${path}${q ? '?'+q : ''}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

function applyClientFilters(rows) {
  const term = $('t-search').value.trim().toLowerCase();
  const borough = filters.borough;

  return rows.filter((r) => {
    if (borough) {
      const pu = zoneById.get(r.pickup_location_id);
      if (pu?.borough !== borough) return false;
    }

    if (term) {
      const puName = (zoneById.get(r.pickup_location_id)?.zone_name || '').toLowerCase();
      const doName = (zoneById.get(r.dropoff_location_id)?.zone_name || '').toLowerCase();
      if (!puName.includes(term) && !doName.includes(term)) return false;
    }

    return true;
  });
}

function computeKpis(rows, totalTrips) {
  const n = rows.length;
  if (n === 0) {
    return {
      total_trips: totalTrips,
      avg_fare: null,
      avg_distance: null,
      avg_duration: null,
      avg_rpm: null,
    };
  }

  const sums = rows.reduce((acc, r) => {
    acc.total += Number(r.total_amount) || 0;
    acc.distance += Number(r.trip_distance_mi) || 0;
    acc.duration += Number(r.trip_duration_min) || 0;
    return acc;
  }, { total: 0, distance: 0, duration: 0 });

  return {
    total_trips: totalTrips,
    avg_fare: sums.total / n,
    avg_distance: sums.distance / n,
    avg_duration: sums.duration / n,
    avg_rpm: sums.distance > 0 ? sums.total / sums.distance : null,
  };
}

function buildFareDistribution(rows) {
  const buckets = [
    { key: '$0-10', min: 0, max: 10, count: 0 },
    { key: '$10-20', min: 10, max: 20, count: 0 },
    { key: '$20-30', min: 20, max: 30, count: 0 },
    { key: '$30-50', min: 30, max: 50, count: 0 },
    { key: '$50+', min: 50, max: Infinity, count: 0 },
  ];

  for (const r of rows) {
    const fare = Number(r.total_amount) || 0;
    const b = buckets.find((x) => fare >= x.min && fare < x.max);
    if (b) b.count += 1;
  }

  return buckets.map((b) => ({ bucket: b.key, count: b.count }));
}

function buildPaymentSplit(rows) {
  const byPayment = new Map();
  for (const r of rows) {
    const key = Number(r.payment_type) || 0;
    byPayment.set(key, (byPayment.get(key) || 0) + 1);
  }
  return Array.from(byPayment.entries()).map(([payment_type, count]) => ({ payment_type, count }));
}

async function loadTripSample() {
  const q = buildQ({ page: 1, page_size: 200, sort_by: 'pickup_datetime', order: 'desc' });
  const res = await get('/trips', q);
  return {
    rows: res?.data || [],
    total: res?.pagination?.total || 0,
  };
}

async function ensureZones() {
  if (zoneById.size > 0) return;
  const res = await get('/zones');
  for (const z of (res?.data || [])) zoneById.set(z.location_id, z);
}

// ── Chart base config ─────────────────────────────────────
const BASE = {
  responsive: true, maintainAspectRatio: true,
  plugins: { legend: { display: false }, tooltip: { backgroundColor:'#161d2e', borderColor:'#1f2d45', borderWidth:1, titleColor:'#e8edf5', bodyColor:'#7a8fa8' } },
  scales: {
    x: { grid:{ color:'#1f2d45' }, ticks:{ color:'#4a5e78', font:{ family:'DM Mono', size:10 } } },
    y: { grid:{ color:'#1f2d45' }, ticks:{ color:'#4a5e78', font:{ family:'DM Mono', size:10 } } },
  }
};

function mk(key, id, type, data, opts = {}) {
  charts[key]?.destroy();
  charts[key] = new Chart($(id).getContext('2d'), { type, data, options: { ...BASE, ...opts } });
}

// ── KPIs ──────────────────────────────────────────────────
async function loadKPIs() {
  const sample = await loadTripSample();
  const filteredRows = applyClientFilters(sample.rows);
  const d = computeKpis(filteredRows, sample.total);
  $('k-trips').textContent = fmt(d.total_trips);
  $('k-fare').textContent  = fmtD(d.avg_fare);
  $('k-dist').textContent  = fmt(d.avg_distance, 2) + ' mi';
  $('k-dur').textContent   = fmt(d.avg_duration, 0) + ' min';
  $('k-rpm').textContent   = fmtD(d.avg_rpm);
}

// ── Hourly chart ──────────────────────────────────────────
async function loadHourly(mode = 'all') {
  const rawRes = await get('/insights/hourly-demand')
    ?? Array.from({length:24}, (_,i) => ({ hour:i, count: Math.round(8000 + 35000*Math.max(0,Math.sin((i-7)*Math.PI/13))) }));
  const raw = rawRes.data || rawRes;
  const ctx = $('c-hourly').getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,220);
  grad.addColorStop(0,'rgba(0,212,255,.3)'); grad.addColorStop(1,'rgba(0,212,255,.02)');
  mk('hourly','c-hourly','line',{
    labels: raw.map(d => (d.hour_of_day ?? d.hour) + ':00'),
    datasets: [{ data: raw.map(d => d.trip_count ?? d.count), borderColor:'#00d4ff', backgroundColor:grad, borderWidth:2, fill:true, tension:.4, pointRadius:0 }]
  });
}

// ── Fare distribution ─────────────────────────────────────
async function loadFare() {
  const sample = await loadTripSample();
  const filteredRows = applyClientFilters(sample.rows);
  const raw = buildFareDistribution(filteredRows);
  mk('fare','c-fare','bar',{
    labels: raw.map(d=>d.bucket),
    datasets: [{ data: raw.map(d=>d.count), backgroundColor:'rgba(0,212,255,.2)', borderColor:'#00d4ff', borderWidth:1, borderRadius:3 }]
  });
}

// ── Payment split ─────────────────────────────────────────
async function loadPayment() {
  const sample = await loadTripSample();
  const filteredRows = applyClientFilters(sample.rows);
  const raw = buildPaymentSplit(filteredRows);
  mk('payment','c-payment','doughnut',{
    labels: raw.map(d => PAYMENT[d.payment_type] ?? 'Other'),
    datasets: [{ data: raw.map(d=>d.count), backgroundColor:['#00d4ff','#f59e0b','#10b981','#f43f5e'], borderColor:'#0a0e1a', borderWidth:3 }]
  }, { plugins: { ...BASE.plugins, legend: { display:true, labels:{ color:'#7a8fa8', font:{size:10}, boxWidth:8 } } }, scales:{} });
}

// ── Top zones ─────────────────────────────────────────────
async function loadZones() {
  const res = await get('/insights/top-zones', buildQ({ metric: 'trip_count', limit: 10 }));
  const raw = res?.data || [
    { zoneName:'Midtown Center', tripCount:95400 },
    { zoneName:'JFK Airport', tripCount:74200 },
  ];
  mk('zones','c-zones','bar',{
    labels: raw.map(d => d.zoneName || d.zone_name),
    datasets: [{ data: raw.map(d => d.tripCount ?? d.count), backgroundColor:'rgba(245,158,11,.25)', borderColor:'#f59e0b', borderWidth:1, borderRadius:3 }]
  }, { indexAxis:'y', scales:{ x:BASE.scales.x, y:{ grid:{display:false}, ticks:{color:'#7a8fa8',font:{size:10}} } } });
}

// ── Tip by borough ────────────────────────────────────────
async function loadTip() {
  const res = await get('/insights/borough-summary');
  const raw = res?.data || [
    { borough:'Manhattan', avg_tip_percentage:18.2 },
    { borough:'Brooklyn', avg_tip_percentage:16.8 },
  ];
  mk('tip','c-tip','bar',{
    labels: raw.map(d=>d.borough),
    datasets: [{ data: raw.map(d => d.avg_tip_percentage ?? d.avg_tip_pct), backgroundColor: raw.map(d=>(BOROUGH_COLOR[d.borough]??'#4a5e78')+'44'), borderColor: raw.map(d=>BOROUGH_COLOR[d.borough]??'#4a5e78'), borderWidth:1.5, borderRadius:4 }]
  });
}

// ── Trips table ───────────────────────────────────────────
async function loadTable() {
  const q = buildQ({ page, page_size: 20, sort_by: $('t-sort').value, order: 'desc' });
  const res = await get('/trips', q);
  const body = $('t-body');
  const filteredRows = applyClientFilters(res?.data || []);

  if (!filteredRows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No trips found.</td></tr>`;
    $('pagination').innerHTML = ''; return;
  }
  body.innerHTML = filteredRows.map(r => `<tr>
    <td>${r.pickup_datetime ? new Date(r.pickup_datetime).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
    <td>${zoneById.get(r.pickup_location_id)?.zone_name || r.pickup_location_id || '—'}</td>
    <td>${zoneById.get(r.dropoff_location_id)?.zone_name || r.dropoff_location_id || '—'}</td>
    <td>${r.trip_distance_mi!=null ? Number(r.trip_distance_mi).toFixed(2)+' mi':'—'}</td>
    <td>${r.trip_duration_min!=null ? Math.round(Number(r.trip_duration_min))+' min':'—'}</td>
    <td class="green">${fmtD(r.fare_amount)}</td>
    <td class="cyan">${r.tip_percentage!=null ? fmt(r.tip_percentage, 2)+'%':'—'}</td>
    <td class="amber">${fmtD(r.total_amount)}</td>
  </tr>`).join('');

  const total = res?.pagination?.total_pages || 1;
  $('pagination').innerHTML = [
    `<button ${page===1?'disabled':''} onclick="page--;loadTable()">‹</button>`,
    ...Array.from({length:Math.min(total,5)}, (_,i) => i+1).map(p =>
      `<button class="${p===page?'active':''}" onclick="page=${p};loadTable()">${p}</button>`),
    `<button ${page===total?'disabled':''} onclick="page++;loadTable()">›</button>`
  ].join('');
}

// ── Collect filters ───────────────────────────────────────
function collectFilters() {
  return {
    start_date:   $('f-start').value,
    end_date:     $('f-end').value,
    borough:      $('f-borough').value,
    payment_type: $('f-payment').value,
    min_distance: $('f-dmin').value,
    max_distance: $('f-dmax').value,
  };
}

// ── Load all ──────────────────────────────────────────────
function loadAll() {
  loadKPIs(); loadHourly(); loadFare(); loadPayment(); loadZones(); loadTip(); loadTable();
  $('last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// ── Events ────────────────────────────────────────────────
$('btn-apply').addEventListener('click', () => { filters = collectFilters(); page = 1; loadAll(); });
$('btn-reset').addEventListener('click', () => {
  ['f-start','f-end','f-borough','f-payment','f-dmin','f-dmax'].forEach(id => $(id).value = '');
  filters = {}; page = 1; loadAll();
});
$('t-go').addEventListener('click', () => { page = 1; loadTable(); loadKPIs(); loadFare(); loadPayment(); });
$('t-search').addEventListener('keydown', e => e.key==='Enter' && $('t-go').click());

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadHourly(btn.dataset.mode);
  });
});

ensureZones().then(loadAll);