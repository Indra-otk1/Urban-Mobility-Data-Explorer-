'use strict';
const API = 'http://localhost:3000/api';
const PAYMENT = { 1:'Credit Card', 2:'Cash', 3:'No Charge', 4:'Dispute' };
const BOROUGH_COLOR = { Manhattan:'#00d4ff', Brooklyn:'#f59e0b', Queens:'#10b981', Bronx:'#f43f5e', 'Staten Island':'#8b5cf6' };

let charts = {}, page = 1, filters = {};

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
  const d = await get('/stats/kpis', buildQ()) ?? {
    total_trips:1284390, avg_fare:14.72, avg_distance:3.18, avg_duration:16, avg_rpm:4.63
  };
  $('k-trips').textContent = fmt(d.total_trips);
  $('k-fare').textContent  = fmtD(d.avg_fare);
  $('k-dist').textContent  = fmt(d.avg_distance, 2) + ' mi';
  $('k-dur').textContent   = fmt(d.avg_duration, 0) + ' min';
  $('k-rpm').textContent   = fmtD(d.avg_rpm);
}

// ── Hourly chart ──────────────────────────────────────────
async function loadHourly(mode = 'all') {
  const raw = await get('/trips/by-hour', buildQ({ mode }))
    ?? Array.from({length:24}, (_,i) => ({ hour:i, count: Math.round(8000 + 35000*Math.max(0,Math.sin((i-7)*Math.PI/13))) }));
  const ctx = $('c-hourly').getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,220);
  grad.addColorStop(0,'rgba(0,212,255,.3)'); grad.addColorStop(1,'rgba(0,212,255,.02)');
  mk('hourly','c-hourly','line',{
    labels: raw.map(d => d.hour + ':00'),
    datasets: [{ data: raw.map(d=>d.count), borderColor:'#00d4ff', backgroundColor:grad, borderWidth:2, fill:true, tension:.4, pointRadius:0 }]
  });
}

// ── Fare distribution ─────────────────────────────────────
async function loadFare() {
  const raw = await get('/trips/fare-dist', buildQ())
    ?? [['$0-5',12000],['$5-10',80000],['$10-15',95000],['$15-20',70000],['$20-30',55000],['$30-50',28000],['$50+',8000]]
       .map(([bucket,count]) => ({bucket,count}));
  mk('fare','c-fare','bar',{
    labels: raw.map(d=>d.bucket),
    datasets: [{ data: raw.map(d=>d.count), backgroundColor:'rgba(0,212,255,.2)', borderColor:'#00d4ff', borderWidth:1, borderRadius:3 }]
  });
}

// ── Payment split ─────────────────────────────────────────
async function loadPayment() {
  const raw = await get('/trips/payment-split', buildQ())
    ?? [{payment_type:1,count:820000},{payment_type:2,count:360000},{payment_type:3,count:15000},{payment_type:4,count:8000}];
  mk('payment','c-payment','doughnut',{
    labels: raw.map(d => PAYMENT[d.payment_type] ?? 'Other'),
    datasets: [{ data: raw.map(d=>d.count), backgroundColor:['#00d4ff','#f59e0b','#10b981','#f43f5e'], borderColor:'#0a0e1a', borderWidth:3 }]
  }, { plugins: { ...BASE.plugins, legend: { display:true, labels:{ color:'#7a8fa8', font:{size:10}, boxWidth:8 } } }, scales:{} });
}

// ── Top zones ─────────────────────────────────────────────
async function loadZones() {
  const raw = await get('/zones/top-pickups', buildQ({ limit:10 }))
    ?? [{zone_name:'Midtown Center',count:95400},{zone_name:'JFK Airport',count:74200},{zone_name:'Upper East Side N',count:68100},
        {zone_name:'Times Sq/Theatre',count:61700},{zone_name:'Penn Station/MW',count:58200}];
  mk('zones','c-zones','bar',{
    labels: raw.map(d=>d.zone_name),
    datasets: [{ data:raw.map(d=>d.count), backgroundColor:'rgba(245,158,11,.25)', borderColor:'#f59e0b', borderWidth:1, borderRadius:3 }]
  }, { indexAxis:'y', scales:{ x:BASE.scales.x, y:{ grid:{display:false}, ticks:{color:'#7a8fa8',font:{size:10}} } } });
}

// ── Tip by borough ────────────────────────────────────────
async function loadTip() {
  const raw = await get('/zones/tip-by-borough', buildQ())
    ?? [{borough:'Manhattan',avg_tip_pct:18.2},{borough:'Brooklyn',avg_tip_pct:16.8},{borough:'Queens',avg_tip_pct:15.4},
        {borough:'Bronx',avg_tip_pct:14.1},{borough:'Staten Island',avg_tip_pct:17.5}];
  mk('tip','c-tip','bar',{
    labels: raw.map(d=>d.borough),
    datasets: [{ data: raw.map(d=>d.avg_tip_pct), backgroundColor: raw.map(d=>(BOROUGH_COLOR[d.borough]??'#4a5e78')+'44'), borderColor: raw.map(d=>BOROUGH_COLOR[d.borough]??'#4a5e78'), borderWidth:1.5, borderRadius:4 }]
  });
}

// ── Trips table ───────────────────────────────────────────
async function loadTable() {
  const q = buildQ({ page, limit:20, sort: $('t-sort').value, order:'DESC', search: $('t-search').value });
  const res = await get('/trips', q);
  const body = $('t-body');
  if (!res?.data?.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">No trips found.</td></tr>`;
    $('pagination').innerHTML = ''; return;
  }
  body.innerHTML = res.data.map(r => `<tr>
    <td>${r.tpep_pickup_datetime ? new Date(r.tpep_pickup_datetime).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
    <td>${r.pickup_zone??'—'}</td><td>${r.dropoff_zone??'—'}</td>
    <td>${r.trip_distance!=null ? r.trip_distance.toFixed(2)+' mi':'—'}</td>
    <td>${r.duration_minutes!=null ? Math.round(r.duration_minutes)+' min':'—'}</td>
    <td class="green">${fmtD(r.fare_amount)}</td>
    <td class="cyan">${fmtD(r.tip_amount)}</td>
    <td class="amber">${fmtD(r.total_amount)}</td>
  </tr>`).join('');

  const total = Math.ceil(res.total / 20);
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
$('t-go').addEventListener('click', () => { page = 1; loadTable(); });
$('t-search').addEventListener('keydown', e => e.key==='Enter' && $('t-go').click());

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadHourly(btn.dataset.mode);
  });
});

loadAll();