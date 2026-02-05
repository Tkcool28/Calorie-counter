/* Calorie Quest — FREE mode (v10)
   Fix: Improved error handling and debugging for Open Food Facts search
   - Better error messages for API failures
   - Console logging for debugging
   - Improved service worker compatibility
   - Fixed Help modal z-index issues
*/

const STORAGE_KEY = 'calorieQuest_free_v10';
const DEFAULT_GOALS = { calories: 2200, protein: 150, carbs: 250, fat: 70 };

const $ = (id) => document.getElementById(id);
const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round0 = (n) => Math.round(Number(n || 0));
const round1 = (n) => (Math.round(Number(n || 0) * 10) / 10).toFixed(1);

function escapeHtml(str){
  return String(str || '')
    .replaceAll('&amp;','&amp;')
    .replaceAll('<','<')
    .replaceAll('>','>')
    .replaceAll('"','&quot;')
    .replaceAll(''','&#039;');
}

function dateKey(d = new Date()){
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}
function parseKey(key){
  const [y,m,d] = key.split('-').map(Number);
  return new Date(y, m-1, d);
}
function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function makeId(){
  return (crypto?.randomUUID?.() || `id_${Math.random().toString(16).slice(2)}_${Date.now()}`);
}
function norm(s){ return String(s||'').toLowerCase().trim().replace(/\s+/g,' '); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function showFatal(err){
  console.error(err);
  let box = document.getElementById('fatalBox');
  if (!box){
    box = document.createElement('div');
    box.id = 'fatalBox';
    box.style.cssText = `
      position:fixed; inset:auto 12px 12px 12px; z-index:99999;
      background:rgba(239,68,68,.14); border:1px solid rgba(239,68,68,.35);
      color:rgba(255,255,255,.92); padding:12px; border-radius:14px;
      font-family:system-ui; font-size:13px; backdrop-filter:blur(10px);
    `;
    document.body.appendChild(box);
  }
  box.innerHTML = `<b>App error:</b> ${escapeHtml(String(err?.message || err))}`;
}

// ---------- Motivation ----------
function motivation(ratio){
  const over = ratio > 1;
  if (over) return pick([
    'Still a win — awareness is power 🧠',
    'Balance beats perfection. Tomorrow is a clean reset ✔️',
    'Data > drama. You're learning your rhythm.'
  ]);
  if (ratio < 0.25) return pick(['Warm-up phase — stack small wins ✔️','One meal at a time.','Momentum is loading…']);
  if (ratio < 0.5)  return pick(['Nice pace — keep logging 🔧🔖🔧','You're on track. Keep it simple.','Consistency is the cheat code.']);
  if (ratio < 0.75) return pick(['Strong progress — finish focused 🧠','Solid day building.','Keep decisions clean.']);
  if (ratio < 1.0)  return pick(['Final stretch — you're close ✔️','Dial it in. Smart choices now.','Almost there — finish strong.']);
  return pick(['Goal met! Victory lap ✔️','Boom. That's how it's done.','You did the thing.']);
}

// ---------- Offline DB (per 100g typical) ----------
const OFFLINE_DB = {
  'chicken breast': { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  'salmon': { calories: 208, protein: 20, carbs: 0, fat: 13 },
  'egg': { calories: 143, protein: 13, carbs: 1.1, fat: 10 },
  'greek yogurt (nonfat)': { calories: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  'oats': { calories: 389, protein: 16.9, carbs: 66.3, fat: 6.9 },
  'brown rice (cooked)': { calories: 111, protein: 2.6, carbs: 23, fat: 0.9 },
  'banana': { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  'apple': { calories: 52, protein: 0.3, carbs: 13.8, fat: 0.2 },
  'broccoli': { calories: 34, protein: 2.8, carbs: 6.6, fat: 0.4 },
  'spinach': { calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4 },
  'avocado': { calories: 160, protein: 2, carbs: 8.5, fat: 14.7 },
  'olive oil': { calories: 884, protein: 0, carbs: 0, fat: 100 },
  'almonds': { calories: 579, protein: 21.2, carbs: 21.6, fat: 49.9 },
  'peanut butter': { calories: 588, protein: 25.1, carbs: 20, fat: 50 },
  'tuna (canned in water)': { calories: 116, protein: 26, carbs: 0, fat: 1 },
  'tofu': { calories: 144, protein: 15.7, carbs: 3.9, fat: 8.7 },
  'lentils (cooked)': { calories: 116, protein: 9, carbs: 20.1, fat: 0.4 },
  'sweet potato': { calories: 86, protein: 1.6, carbs: 20.1, fat: 0.1 }
};

function bestOfflineMatch(query){
  const q = new Set(norm(query).split(' ').filter(Boolean));
  if (!q.size) return null;

  let bestName = '';
  let bestScore = 0;

  for (const name of Object.keys(OFFLINE_DB)){
    const t = new Set(norm(name).split(' '));
    let inter = 0;
    q.forEach(w => { if (t.has(w)) inter++; });
    const union = new Set([...q, ...t]).size;
    const score = union ? inter/union : 0;
    if (score > bestScore){
      bestScore = score;
      bestName = name;
    }
  }
  return bestScore > 0 ? { name: bestName, score: bestScore } : null;
}

function scalePer100(nut, grams){
  const f = Math.max(Number(grams)||0, 0) / 100;
  return {
    calories: (nut.calories||0) * f,
    protein: (nut.protein||0) * f,
    carbs: (nut.carbs||0) * f,
    fat: (nut.fat||0) * f
  };
}

// ---------- Language helpers ----------
function looksNonLatin(s){
  const t = String(s||'').trim();
  if (!t) return false;
  let letters = 0;
  let nonLatin = 0;
  for (const ch of t){
    if (/[A-Za-z]/.test(ch)){ letters++; continue; }
    if (/[\u00C0-\u024F]/.test(ch)){ letters++; continue; }
    if (/[\u0400-\u04FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF]/.test(ch)){
      letters++; nonLatin++;
    }
  }
  if (!letters) return false;
  return (nonLatin/letters) > 0.35;
}

// ---------- OFF scoring: choose best match instead of first result ----------
function tokenize(s){
  return norm(s)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 2);
}

function jaccard(aTokens, bTokens){
  const A = new Set(aTokens), B = new Set(bTokens);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(t => { if (B.has(t)) inter++; });
  const union = new Set([...A, ...B]).size;
  return union ? inter/union : 0;
}

function scoreProduct(query, name, brand){
  const q = norm(query);
  const text = norm([name, brand].filter(Boolean).join(' '));
  const qTok = tokenize(q);
  const tTok = tokenize(text);

  let score = jaccard(qTok, tTok);

  // Bonuses: substring matches
  if (text.includes(q)) score += 0.35;
  // Bonus if query tokens all appear somewhere
  const allTokensHit = qTok.length &amp;&amp; qTok.every(t => tTok.includes(t));
  if (allTokensHit) score += 0.25;

  // Small bonus for shorter/cleaner names (less marketing fluff)
  const len = Math.min(text.length, 120);
  score += (1 - len/120) * 0.10;

  return score;
}

// ---------- Open Food Facts (better search with improved error handling) ----------
async function searchOpenFoodFactsMulti(query){
  const q = (query||'').trim();
  if (!q) return { best: null, list: [] };

  console.log('🔍 Searching Open Food Facts for:', q);

  // Pull multiple results + request English fields + nutriments.
  // sort_by=unique_scans_n usually improves relevance/popularity.
  const url =
    'https://world.openfoodfacts.org/api/v2/search' +
    `?search_terms=${encodeURIComponent(q)}` +
    '&amp;page_size=20' +
    '&amp;lc=en&amp;cc=us' +
    '&amp;sort_by=unique_scans_n' +
    '&amp;fields=product_name_en,product_name,brands,nutriments,unique_scans_n';

  try {
    console.log('🌐 Fetching URL:', url);
    
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-cache'
    });

    console.log('📡 Response status:', res.status, res.statusText);

    if (!res.ok) {
      throw new Error(`Open Food Facts API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const products = (data?.products || []).slice(0, 20);

    console.log('📦 Received products:', products.length);

    if (products.length === 0) {
      console.log('⚠️ No products found for query:', q);
      return { best: null, list: [] };
    }

    const candidates = [];
    for (const p of products){
      const n = p.nutriments || {};
      const kcal = n['energy-kcal_100g'] ?? n['energy_kcal_100g'] ?? 0;
      const protein = n['proteins_100g'] ?? 0;
      const carbs = n['carbohydrates_100g'] ?? 0;
      const fat = n['fat_100g'] ?? 0;

      // Require at least calories OR one macro to avoid junk results
      if (!kcal &amp;&amp; !protein &amp;&amp; !carbs &amp;&amp; !fat) continue;

      const brands = (p.brands || '').trim();
      const rawName = (p.product_name_en || p.product_name || '').trim();

      // Avoid non-Latin display names when english isn't available
      const displayName =
        (!rawName || looksNonLatin(rawName))
          ? [q, brands].filter(Boolean).join(' — ')
          : [rawName, brands].filter(Boolean).join(' — ');

      const s = scoreProduct(q, rawName || displayName, brands);

      candidates.push({
        displayName: displayName || q,
        brands,
        per100g: { calories: kcal, protein, carbs, fat },
        score: s
      });
    }

    candidates.sort((a,b)=> b.score - a.score);

    const best = candidates[0] || null;
    console.log('✅ Best match found:', best?.displayName, 'Score:', best?.score);
    console.log('📋 All candidates:', candidates.length);
    
    return { best, list: candidates.slice(0, 8) }; // show top 8 in dropdown
    
  } catch (error) {
    console.error('❌ Open Food Facts search failed:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      query: q
    });
    // Return empty results but don't crash the app
    return { best: null, list: [] };
  }
}

// ---------- Storage ----------
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { days: {}, ui: {} };
    const parsed = JSON.parse(raw);
    return { days: parsed.days || {}, ui: parsed.ui || {} };
  }catch{
    return { days: {}, ui: {} };
  }
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function ensureDay(key){
  if (!state.days[key]) state.days[key] = { goals: { ...DEFAULT_GOALS }, entries: [] };
  if (!state.days[key].goals) state.days[key].goals = { ...DEFAULT_GOALS };
  if (!Array.isArray(state.days[key].entries)) state.days[key].entries = [];
}
function totals(entries){
  return (entries||[]).reduce((t,e)=>({
    calories: t.calories + (Number(e.calories)||0),
    protein: t.protein + (Number(e.protein)||0),
    carbs: t.carbs + (Number(e.carbs)||0),
    fat: t.fat + (Number(e.fat)||0),
  }), {calories:0, protein:0, carbs:0, fat:0});
}

// ---------- Suggestions &amp; Meal Plan ----------
function suggestFoods(remaining){
  const cal = Math.max(remaining.calories, 0);
  const p = Math.max(remaining.protein, 0);
  const c = Math.max(remaining.carbs, 0);
  const f = Math.max(remaining.fat, 0);
  const w = [0.15, 0.30, 0.30, 0.25];

  const scored = Object.entries(OFFLINE_DB).map(([name, nut]) => {
    let score =
      w[0] * (Math.min(nut.calories, cal) / (cal + 1e-6)) +
      w[1] * (Math.min(nut.protein, p) / (p + 1e-6)) +
      w[2] * (Math.min(nut.carbs, c) / (c + 1e-6)) +
      w[3] * (Math.min(nut.fat, f) / (f + 1e-6));
    if (cal > 0 &amp;&amp; nut.calories > cal*1.5) score *= 0.6;
    return { name, per100g: nut, score };
  });

  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0,8);
}

function generateMealPlan(goals){
  const splits = { Breakfast:0.25, Lunch:0.30, Snack:0.15, Dinner:0.30 };
  const proteinFoods = ['chicken breast','tuna (canned in water)','tofu','egg','greek yogurt (nonfat)','salmon'];
  const carbFoods = ['oats','brown rice (cooked)','sweet potato','banana','lentils (cooked)','apple'];
  const vegFoods = ['broccoli','spinach'];
  const fatFoods = ['avocado','olive oil','almonds','peanut butter'];
  const pickFrom = (arr) => arr.filter(x=>OFFLINE_DB[x]).sort(()=>Math.random()-0.5)[0] || Object.keys(OFFLINE_DB)[0];

  const plan = {};
  for (const meal of Object.keys(splits)){
    const targetCal = goals.calories * splits[meal];
    const items = [
      { food: pickFrom(proteinFoods), grams:150 },
      { food: pickFrom(carbFoods), grams:150 },
      { food: pickFrom(vegFoods), grams:120 },
    ];
    if (meal === 'Lunch' || meal === 'Dinner') items.push({ food: pickFrom(fatFoods), grams:20 });

    const base = items.reduce((sum,it)=> sum + OFFLINE_DB[it.food].calories*(it.grams/100), 0);
    let factor = base > 0 ? targetCal/base : 1;
    factor = Math.max(0.6, Math.min(1.6, factor));

    plan[meal] = items.map(it => ({...it, grams: Math.round(it.grams*factor)}));
  }
  return plan;
}

// ---------- UI builders ----------
function kpiHTML(title, value, sub){
  return `
    <div class="kpi">
      <div class="k">${title}</div>
      <div class="v">${value}</div>
      ${sub ? `<div class="hint">${sub}</div>` : ''}
    </div>
  `;
}
function barHTML(label, badge, current, goal, unit){
  const g = Math.max(Number(goal)||0, 1e-6);
  const cur = Number(current)||0;
  const ratio = cur/g;
  const pct = clamp01(ratio);
  return `
    <div class="bar">
      <div class="barTop">
        <div style="font-weight:950;">${label}${badge?`<span class="badge">${badge}</span>`:''}</div>
        <div class="hint">${round0(cur)}/${round0(g)} ${unit} (${Math.min(ratio*100,999).toFixed(0)}%)</div>
      </div>
      <div class="track"><div class="fill" style="width:${pct*100}%"></div></div>
      <div class="mot">${motivation(ratio)}</div>
    </div>
  `;
}

// ---------- Charts ----------
function drawLineChart(canvas, labels, values){
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width = Math.floor(canvas.clientWidth * dpr);
  const h = canvas.height = Math.floor(canvas.clientHeight * dpr);

  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0,0,w,h);

  const pad = 18*dpr;
  const innerW = w - pad*2;
  const innerH = h - pad*2;
  const maxV = Math.max(1, ...values);
  const minV = Math.min(0, ...values);

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1*dpr;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h-pad);
  ctx.lineTo(w-pad, h-pad);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(6,182,212,0.95)';
  ctx.lineWidth = 2.5*dpr;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const x = pad + (i/((values.length-1)||1))*innerW;
    const yNorm = (v-minV)/((maxV-minV)||1);
    const y = (h-pad) - yNorm*innerH;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  ctx.fillStyle = 'rgba(124,58,237,0.95)';
  values.forEach((v,i)=>{
    const x = pad + (i/((values.length-1)||1))*innerW;
    const yNorm = (v-minV)/((maxV-minV)||1);
    const y = (h-pad) - yNorm*innerH;
    ctx.beginPath();
    ctx.arc(x,y, 3.5*dpr, 0, Math.PI*2);
    ctx.fill();
  });

  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = `${12*dpr}px system-ui`;
  ctx.textBaseline = 'top';
  if(labels.length){
    ctx.fillText(labels[0], pad, h-pad + 6*dpr);
    const last = labels[labels.length-1];
    const tw = ctx.measureText(last).width;
    ctx.fillText(last, w-pad-tw, h-pad + 6*dpr);
  }
}

// ---------- Analytics ----------
function rangeKeys(endKey, daysBack){
  const end = parseKey(endKey);
  const keys = [];
  for(let i=daysBack-1;i>=0;i--) keys.push(dateKey(addDays(end, -i)));
  return keys;
}
function summarizeRange(keys){
  const perDay = keys.map(k=>{
    const day = state.days[k];
    const t = day ? totals(day.entries) : {calories:0, protein:0, carbs:0, fat:0};
    return { key:k, totals:t };
  });
  const sum = perDay.reduce((acc,d)=>({
    calories: acc.calories + d.totals.calories,
    protein: acc.protein + d.totals.protein,
    carbs: acc.carbs + d.totals.carbs,
    fat: acc.fat + d.totals.fat
  }), {calories:0, protein:0, carbs:0, fat:0});
  const avg = {
    calories: sum.calories/keys.length,
    protein: sum.protein/keys.length,
    carbs: sum.carbs/keys.length,
    fat: sum.fat/keys.length
  };
  return { perDay, sum, avg };
}
function availableMonths(){
  const set = new Set();
  Object.keys(state.days||{}).forEach(k=>set.add(k.slice(0,7)));
  return Array.from(set).sort();
}
function monthKeys(year, monthIndex0){
  const first = new Date(year, monthIndex0, 1);
  const keys = [];
  for(let d=new Date(first); d.getMonth()===monthIndex0; d.setDate(d.getDate()+1)){
    keys.push(dateKey(d));
  }
  return keys;
}

// ---------- Help Modal (improved free mode) ----------
let helpModalEl = null;

function openHelpScreen(){
  if (helpModalEl) return;

  helpModalEl = document.createElement('div');
  helpModalEl.className = 'helpModal';
  // Fixed z-index to ensure it appears on top
  helpModalEl.style.cssText = 'position:fixed; inset:0; z-index:999998; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center;';
  
  helpModalEl.innerHTML = `
    <div class="helpInner" style="background:#1a1d2d; border-radius:16px; max-width:600px; width:90%; max-height:90vh; overflow-y:auto; padding:20px; color:white;">
      <div class="helpTop" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div class="helpTitle" style="font-size:20px; font-weight:bold;">Help &amp; Suggestions (Free)</div>
        <button class="btn ghost helpClose" id="helpCloseBtn" style="background:transparent; border:1px solid rgba(255,255,255,0.3); color:white; padding:8px 16px; border-radius:8px;">Close</button>
      </div>

      <div class="helpBody">
        <div class="hint" style="background:rgba(255,193,7,0.1); border-left:3px solid #ffc107; padding:10px; margin-bottom:16px; border-radius:4px;">
          Wikipedia answers can be flaky on mobile networks; suggestions + meal plan are always available.
        </div>

        <div class="helpSplit" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
          <div>
            <div class="helpBoxTitle" style="font-weight:bold; margin-bottom:8px;">What to eat next (based on today)</div>
            <div id="helpSuggestOut" class="subcard" style="background:rgba(0,0,0,0.2); padding:12px; border-radius:8px;"></div>
          </div>
          <div>
            <div class="helpBoxTitle" style="font-weight:bold; margin-bottom:8px;">Full-day meal planner</div>
            <div class="row" style="display:flex; gap:8px; margin-bottom:8px;">
              <button class="btn primary grow" id="helpPlanBtn" style="flex:1; background:#4f46e5; color:white; border:none; padding:10px; border-radius:8px;">Generate meal plan 🧠</button>
              <button class="btn ghost grow" id="helpPlanClearBtn" style="flex:1; background:transparent; border:1px solid rgba(255,255,255,0.3); color:white; padding:10px; border-radius:8px;">Clear plan</button>
            </div>
            <div id="helpPlanOut" class="subcard" style="background:rgba(0,0,0,0.2); padding:12px; border-radius:8px;"><div class="hint">Tap "Generate meal plan".</div></div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(helpModalEl);

  on($('helpCloseBtn'), 'click', closeHelpScreen);
  on($('helpPlanBtn'), 'click', renderHelpMealPlan);
  on($('helpPlanClearBtn'), 'click', () => {
    const el = $('helpPlanOut');
    if (el) el.innerHTML = `<div class="hint">Tap "Generate meal plan".</div>`;
  });

  document.addEventListener('keydown', escCloseHelp);
  renderHelpSuggestions();
}

function closeHelpScreen(){
  if (!helpModalEl) return;
  document.removeEventListener('keydown', escCloseHelp);
  helpModalEl.remove();
  helpModalEl = null;
}
function escCloseHelp(e){ if (e.key === 'Escape') closeHelpScreen(); }

function getTodayContext(){
  const day = state.days[today
