/* Calorie Quest PWA (4 files, root-only)
   Files in repo root:
     - index.html
     - style.css
     - app.js
     - sw.js

   Features:
   - Log foods with serving grams
   - Search nutrition: Offline DB + optional Open Food Facts (free)
   - Daily goals for calories + macros
   - Progress bars + motivation snippets
   - Help: suggestions + full-day meal planner
   - Analytics: 7D, 30D, calendar-month trend charts (canvas)
   - localStorage persistence (free, offline)
*/

const LS_KEY = "calorieQuest_root_v1";

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round0 = (n) => Math.round(Number(n || 0));
const round1 = (n) => (Math.round(Number(n || 0) * 10) / 10).toFixed(1);

function dateKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function makeId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
function norm(s) {
  return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- Motivation ----------
function motivation(ratio) {
  const over = ratio > 1;
  if (over) return pick([
    "Still a win — awareness is power 💡",
    "Balance beats perfection. Tomorrow is a reset ✔️",
    "Data > drama. Keep going 🔥",
  ]);
  if (ratio < 0.25) return pick(["Warm-up phase — stack small wins ✔️", "One meal at a time.", "Momentum is loading…"]);
  if (ratio < 0.5)  return pick(["Nice pace — keep it steady 🔨🤖🔧", "Solid progress. Keep logging!", "Consistency is the cheat code."]);
  if (ratio < 0.75) return pick(["Strong progress — finish focused 💡", "You’re building momentum.", "Keep decisions clean."]);
  if (ratio < 1)    return pick(["Final stretch — you’re close ✔️", "Dial it in — smart choices now.", "Almost there — finish strong."]);
  return pick(["Goal met! Victory lap ✔️", "Boom. That’s how it’s done.", "Nailed it — repeat what worked."]);
}

// ---------- Offline DB (per 100g typical values) ----------
const OFFLINE_DB = {
  "chicken breast": { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  "salmon": { calories: 208, protein: 20, carbs: 0, fat: 13 },
  "egg": { calories: 143, protein: 13, carbs: 1.1, fat: 10 },
  "greek yogurt (nonfat)": { calories: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  "oats": { calories: 389, protein: 16.9, carbs: 66.3, fat: 6.9 },
  "brown rice (cooked)": { calories: 111, protein: 2.6, carbs: 23, fat: 0.9 },
  "banana": { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
  "apple": { calories: 52, protein: 0.3, carbs: 13.8, fat: 0.2 },
  "broccoli": { calories: 34, protein: 2.8, carbs: 6.6, fat: 0.4 },
  "spinach": { calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4 },
  "avocado": { calories: 160, protein: 2, carbs: 8.5, fat: 14.7 },
  "olive oil": { calories: 884, protein: 0, carbs: 0, fat: 100 },
  "almonds": { calories: 579, protein: 21.2, carbs: 21.6, fat: 49.9 },
  "peanut butter": { calories: 588, protein: 25.1, carbs: 20, fat: 50 },
  "tuna (canned in water)": { calories: 116, protein: 26, carbs: 0, fat: 1 },
  "tofu": { calories: 144, protein: 15.7, carbs: 3.9, fat: 8.7 },
  "lentils (cooked)": { calories: 116, protein: 9, carbs: 20.1, fat: 0.4 },
  "sweet potato": { calories: 86, protein: 1.6, carbs: 20.1, fat: 0.1 }
};

function scalePer100(per100, grams) {
  const f = (Number(grams) || 0) / 100;
  return {
    calories: (per100.calories || 0) * f,
    protein: (per100.protein || 0) * f,
    carbs: (per100.carbs || 0) * f,
    fat: (per100.fat || 0) * f,
  };
}

function bestOfflineMatch(query) {
  const q = new Set(norm(query).split(" ").filter(Boolean));
  if (!q.size) return null;

  let bestName = null;
  let bestScore = 0;

  for (const name of Object.keys(OFFLINE_DB)) {
    const t = new Set(norm(name).split(" "));
    let inter = 0;
    for (const w of q) if (t.has(w)) inter++;
    const union = new Set([...q, ...t]).size;
    const score = union ? inter / union : 0;
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }
  return bestName ? { name: bestName, score: bestScore } : null;
}

// ---------- Open Food Facts (free, no key) ----------
async function searchOpenFoodFacts(query) {
  const q = query.trim();
  if (!q) return null;

  const url =
    "https://world.openfoodfacts.org/api/v2/search" +
    `?search_terms=${encodeURIComponent(q)}` +
    "&page_size=1" +
    "&fields=product_name,brands,nutriments";

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const product = data?.products?.[0];
  if (!product) return null;

  const nutr = product.nutriments || {};
  const kcal = nutr["energy-kcal_100g"] ?? nutr["energy_kcal_100g"] ?? 0;
  const protein = nutr["proteins_100g"] ?? 0;
  const carbs = nutr["carbohydrates_100g"] ?? 0;
  const fat = nutr["fat_100g"] ?? 0;

  if (kcal === 0 && protein === 0 && carbs === 0 && fat === 0) return null;

  const name = [product.product_name, product.brands].filter(Boolean).join(" — ") || q;
  return { name, per100g: { calories: kcal, protein, carbs, fat } };
}

// ---------- Storage (multi-day) ----------
const DEFAULT_GOALS = { calories: 2200, protein: 150, carbs: 250, fat: 70 };

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { days: {}, ui: {} };
    const parsed = JSON.parse(raw);
    return { days: parsed.days || {}, ui: parsed.ui || {} };
  } catch {
    return { days: {}, ui: {} };
  }
}
function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function ensureDay(key) {
  if (!state.days[key]) state.days[key] = { goals: { ...DEFAULT_GOALS }, entries: [] };
  if (!state.days[key].goals) state.days[key].goals = { ...DEFAULT_GOALS };
  if (!Array.isArray(state.days[key].entries)) state.days[key].entries = [];
}

function totals(entries) {
  return entries.reduce(
    (t, e) => ({
      calories: t.calories + (Number(e.calories) || 0),
      protein: t.protein + (Number(e.protein) || 0),
      carbs: t.carbs + (Number(e.carbs) || 0),
      fat: t.fat + (Number(e.fat) || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

// ---------- Suggestions + Meal Plan ----------
function suggestFoods(remaining, prefer) {
  const cal = Math.max(remaining.calories, 0);
  const p = Math.max(remaining.protein, 0);
  const c = Math.max(remaining.carbs, 0);
  const f = Math.max(remaining.fat, 0);

  const w =
    prefer === "protein" ? [0.1, 0.6, 0.15, 0.15] :
    prefer === "carbs" ? [0.1, 0.15, 0.6, 0.15] :
    prefer === "fat" ? [0.1, 0.15, 0.15, 0.6] :
    [0.15, 0.30, 0.30, 0.25];

  const scored = Object.entries(OFFLINE_DB).map(([name, nut]) => {
    let score =
      w[0] * (Math.min(nut.calories, cal) / (cal + 1e-6)) +
      w[1] * (Math.min(nut.protein, p) / (p + 1e-6)) +
      w[2] * (Math.min(nut.carbs, c) / (c + 1e-6)) +
      w[3] * (Math.min(nut.fat, f) / (f + 1e-6));
    if (cal > 0 && nut.calories > cal * 1.5) score *= 0.6;
    return { name, per100g: nut, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}

function generateMealPlan(goals) {
  const splits = [
    ["Breakfast", 0.25],
    ["Lunch", 0.30],
    ["Snack", 0.15],
    ["Dinner", 0.30],
  ];

  const proteinFoods = ["chicken breast", "tuna (canned in water)", "tofu", "egg", "greek yogurt (nonfat)", "salmon"];
  const carbFoods = ["oats", "brown rice (cooked)", "sweet potato", "banana", "apple", "lentils (cooked)"];
  const vegFoods = ["broccoli", "spinach"];
  const fatFoods = ["avocado", "olive oil", "almonds", "peanut butter"];

  const pickFrom = (arr) => {
    const ok = arr.filter((x) => OFFLINE_DB[x]);
    return ok[Math.floor(Math.random() * ok.length)];
  };

  const plan = {};
  for (const [meal, frac] of splits) {
    const targetCal = goals.calories * frac;
    const items = [
      { food: pickFrom(proteinFoods), grams: 150 },
      { food: pickFrom(carbFoods), grams: 150 },
      { food: pickFrom(vegFoods), grams: 120 },
    ];
    if (meal === "Lunch" || meal === "Dinner") items.push({ food: pickFrom(fatFoods), grams: 20 });

    const baseCals = items.reduce((sum, it) => sum + OFFLINE_DB[it.food].calories * (it.grams / 100), 0);
    let factor = baseCals > 0 ? targetCal / baseCals : 1;
    factor = Math.max(0.6, Math.min(1.6, factor));

    plan[meal] = items.map((it) => ({ ...it, grams: Math.round(it.grams * factor) }));
  }
  return plan;
}

// ---------- Analytics ----------
function rangeKeys(endKey, daysBack) {
  const end = parseKey(endKey);
  const keys = [];
  for (let i = daysBack - 1; i >= 0; i--) keys.push(dateKey(addDays(end, -i)));
  return keys;
}

function dayTotals(key) {
  const day = state.days[key];
  if (!day) return { calories: 0, protein: 0, carbs: 0, fat: 0 };
  return totals(day.entries || []);
}

function summarizeRange(keys) {
  const perDay = keys.map((k) => ({ key: k, totals: dayTotals(k) }));
  const sum = perDay.reduce(
    (acc, d) => ({
      calories: acc.calories + d.totals.calories,
      protein: acc.protein + d.totals.protein,
      carbs: acc.carbs + d.totals.carbs,
      fat: acc.fat + d.totals.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const avg = {
    calories: sum.calories / keys.length,
    protein: sum.protein / keys.length,
    carbs: sum.carbs / keys.length,
    fat: sum.fat / keys.length,
  };
  return { perDay, sum, avg };
}

function availableMonths() {
  const set = new Set();
  for (const k of Object.keys(state.days || {})) set.add(k.slice(0, 7)); // YYYY-MM
  return Array.from(set).sort();
}

function monthKeys(year, month1to12) {
  const m0 = month1to12 - 1;
  const first = new Date(year, m0, 1);
  const keys = [];
  for (let d = new Date(first); d.getMonth() === m0; d.setDate(d.getDate() + 1)) keys.push(dateKey(d));
  return keys;
}

function drawLineChart(canvas, labels, values) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width = Math.floor(canvas.clientWidth * dpr));
  const h = (canvas.height = Math.floor(canvas.clientHeight * dpr));

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(0, 0, w, h);

  const pad = 18 * dpr;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  const maxV = Math.max(1, ...values);
  const minV = Math.min(0, ...values);

  // axes
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  // line
  ctx.strokeStyle = "rgba(6,182,212,0.95)";
  ctx.lineWidth = 2.5 * dpr;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + (i / (values.length - 1 || 1)) * innerW;
    const yNorm = (v - minV) / (maxV - minV || 1);
    const y = h - pad - yNorm * innerH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // points
  ctx.fillStyle = "rgba(124,58,237,0.95)";
  values.forEach((v, i) => {
    const x = pad + (i / (values.length - 1 || 1)) * innerW;
    const yNorm = (v - minV) / (maxV - minV || 1);
    const y = h - pad - yNorm * innerH;
    ctx.beginPath();
    ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  });

  // minimal labels (first/last)
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `${12 * dpr}px system-ui`;
  ctx.textBaseline = "top";
  if (labels.length) {
    ctx.fillText(labels[0], pad, h - pad + 6 * dpr);
    const last = labels[labels.length - 1];
    const tw = ctx.measureText(last).width;
    ctx.fillText(last, w - pad - tw, h - pad + 6 * dpr);
  }
}

// ---------- UI render helpers ----------
function barHTML(label, badge, current, goal, unit) {
  const g = Math.max(Number(goal) || 0, 1e-6);
  const cur = Number(current) || 0;
  const ratio = cur / g;
  const pct = clamp01(ratio);
  const width = `${pct * 100}%`;

  return `
    <div class="bar">
      <div class="barTop">
        <div style="font-weight:950;">
          ${label}${badge ? `<span class="badge">${badge}</span>` : ""}
        </div>
        <div class="hint">${round0(cur)}/${round0(g)} ${unit} (${Math.min(ratio * 100, 999).toFixed(0)}%)</div>
      </div>
      <div class="track"><div class="fill" style="width:${width}"></div></div>
      <div class="mot">${motivation(ratio)}</div>
    </div>
  `;
}

function kpiHTML(title, value, sub) {
  return `
    <div class="kpi">
      <div class="k">${title}</div>
      <div class="v">${value}</div>
      ${sub ? `<div class="hint">${sub}</div>` : ""}
    </div>
  `;
}

// ---------- App state ----------
let state = loadState();
const TODAY = dateKey(new Date());
ensureDay(TODAY);

let currentPreview = null; // { name, perServing, note, source }
let analyticsTab = state.ui?.analyticsTab || "week"; // week | month | calendar
let selectedMonth = state.ui?.selectedMonth || null; // YYYY-MM
let helpOpen = state.ui?.helpOpen ?? true;
let prefer = state.ui?.prefer || "balanced";
let searchMode = state.ui?.searchMode || "offline";
let manualMode = state.ui?.manualMode ?? false;

function persistUI() {
  state.ui = { analyticsTab, selectedMonth, helpOpen, prefer, searchMode, manualMode };
  saveState();
}

// ---------- Core actions ----------
async function doSearch() {
  const q = ($("foodQuery")?.value || "").trim();
  const grams = Number($("grams")?.value || 0);

  currentPreview = null;
  renderPreview();

  if (!q || grams <= 0) return;

  $("btnSearch").disabled = true;
  $("btnSearch").textContent = "Searching…";

  try {
    if (searchMode === "openfoodfacts") {
      const off = await searchOpenFoodFacts(q);
      if (off) {
        const perServing = scalePer100(off.per100g, grams);
        currentPreview = { name: off.name, perServing, note: "Open Food Facts match", source: "openfoodfacts" };
        renderPreview();
        return;
      }
    }

    const m = bestOfflineMatch(q);
    if (m && m.score >= 0.2) {
      const per100g = OFFLINE_DB[m.name];
      const perServing = scalePer100(per100g, grams);
      currentPreview = { name: m.name, perServing, note: `Offline match (${Math.round(m.score * 100)}%)`, source: "offline" };
      renderPreview();
      return;
    }

    currentPreview = null;
    renderPreview("No match found. Try Open Food Facts or use Manual entry.");
  } catch {
    currentPreview = null;
    renderPreview("Search failed (network?). Try Offline or Manual entry.");
  } finally {
    $("btnSearch").disabled = false;
    $("btnSearch").textContent = "Search ✔️";
  }
}

function logFood() {
  ensureDay(TODAY);
  const day = state.days[TODAY];

  const grams = Number($("grams")?.value || 0);
  const meal = $("meal")?.value || "Breakfast";
  const nameInput = ($("foodQuery")?.value || "").trim();

  if (grams <= 0) return;

  if (manualMode) {
    const entry = {
      id: makeId(),
      meal,
      name: nameInput || "Manual item",
      grams,
      calories: Number($("m_cal")?.value || 0),
      protein: Number($("m_p")?.value || 0),
      carbs: Number($("m_c")?.value || 0),
      fat: Number($("m_f")?.value || 0),
      source: "manual",
      createdAt: Date.now()
    };
    day.entries.unshift(entry);
    saveState();
    renderAll();
    return;
  }

  if (!currentPreview) return;

  const entry = {
    id: makeId(),
    meal,
    name: currentPreview.name,
    grams,
    calories: currentPreview.perServing.calories,
    protein: currentPreview.perServing.protein,
    carbs: currentPreview.perServing.carbs,
    fat: currentPreview.perServing.fat,
    source: currentPreview.source,
    createdAt: Date.now()
  };

  day.entries.unshift(entry);
  saveState();
  renderAll();
}

function removeEntry(id) {
  ensureDay(TODAY);
  state.days[TODAY].entries = state.days[TODAY].entries.filter(e => e.id !== id);
  saveState();
  renderAll();
}

function resetToday() {
  ensureDay(TODAY);
  state.days[TODAY].entries = [];
  saveState();
  currentPreview = null;
  renderAll();
}

function saveGoals() {
  ensureDay(TODAY);
  state.days[TODAY].goals = {
    calories: Number($("g_cal")?.value || DEFAULT_GOALS.calories),
    protein: Number($("g_p")?.value || DEFAULT_GOALS.protein),
    carbs: Number($("g_c")?.value || DEFAULT_GOALS.carbs),
    fat: Number($("g_f")?.value || DEFAULT_GOALS.fat),
  };
  saveState();
  renderAll();
}

// ---------- Rendering ----------
function renderPreview(msg) {
  const previewEl = $("preview");
  const manualPanel = $("manualPanel");

  if (manualPanel) manualPanel.classList.toggle("hidden", !manualMode);
  if (!previewEl) return;

  previewEl.classList.toggle("hidden", manualMode);

  if (manualMode) return;

  if (currentPreview) {
    const p = currentPreview.perServing;
    previewEl.innerHTML = `
      <div class="subTitle">${escapeHtml(currentPreview.name)}</div>
      <div class="hint">${escapeHtml(currentPreview.note)}</div>
      <div class="kpis" style="grid-template-columns:1fr 1fr; margin-top:10px;">
        ${kpiHTML("Calories", `${round0(p.calories)}`)}
        ${kpiHTML("Protein", `${round1(p.protein)} g`)}
        ${kpiHTML("Carbs", `${round1(p.carbs)} g`)}
        ${kpiHTML("Fat", `${round1(p.fat)} g`)}
      </div>
      <div class="hint" style="margin-top:8px;">Source: ${escapeHtml(currentPreview.source)}</div>
    `;
    previewEl.classList.remove("hidden");
    return;
  }

  if (msg) {
    previewEl.innerHTML = `<div class="hint">${escapeHtml(msg)}</div>`;
    previewEl.classList.remove("hidden");
  } else {
    previewEl.innerHTML = ``;
    previewEl.classList.add("hidden");
  }
}

function renderAll() {
  ensureDay(TODAY);
  const day = state.days[TODAY];
  const goals = day.goals || { ...DEFAULT_GOALS };
  const entries = day.entries || [];
  const tot = totals(entries);
  const remaining = {
    calories: goals.calories - tot.calories,
    protein: goals.protein - tot.protein,
    carbs: goals.carbs - tot.carbs,
    fat: goals.fat - tot.fat
  };

  // Inputs: keep UI state synced
  $("searchMode").value = searchMode;
  $("manualMode").checked = manualMode;

  // Goals inputs
  $("g_cal").value = goals.calories;
  $("g_p").value = goals.protein;
  $("g_c").value = goals.carbs;
  $("g_f").value = goals.fat;

  // KPI + bars
  $("kpis").innerHTML = `
    ${kpiHTML("Consumed", `${round0(tot.calories)} kcal`)}
    ${kpiHTML("Remaining", `${round0(Math.max(remaining.calories, 0))} kcal`)}
  `;

  $("bars").innerHTML = `
    ${barHTML("Calories", "Energy", tot.calories, goals.calories, "kcal")}
    <div class="hr"></div>
    <div class="subTitle">Macro Nutrients</div>
    ${barHTML("Protein", "Build", tot.protein, goals.protein, "g")}
    ${barHTML("Carbs", "Fuel", tot.carbs, goals.carbs, "g")}
    ${barHTML("Fat", "Balance", tot.fat, goals.fat, "g")}
  `;

  // Today log
  $("todayLog").innerHTML = entries.length ? `
    <div class="tableWrap">
      <table>
        <thead><tr><th>Meal</th><th>Food</th><th>g</th><th>kcal</th><th>P</th><th>C</th><th>F</th><th></th></tr></thead>
        <tbody>
          ${entries.map(e => `
            <tr>
              <td><span class="pillMini">${escapeHtml(e.meal)}</span></td>
              <td>${escapeHtml(e.name)}</td>
              <td>${round0(e.grams)}</td>
              <td>${round0(e.calories)}</td>
              <td>${round1(e.protein)}</td>
              <td>${round1(e.carbs)}</td>
              <td>${round1(e.fat)}</td>
              <td><button class="btn danger" data-rm="${e.id}">Remove</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : `<div class="hint">No entries yet. Log your first meal above.</div>`;

  document.querySelectorAll("[data-rm]").forEach(btn => {
    btn.onclick = () => removeEntry(btn.getAttribute("data-rm"));
  });

  // Preview/manual panels
  renderPreview();

  // Help
  const helpPanel = $("helpPanel");
  helpPanel.classList.toggle("hidden", !helpOpen);

  if (helpOpen) {
    const suggestions = suggestFoods(remaining, prefer);
    helpPanel.innerHTML = `
      <div class="cardTitle">Help & Meal Planning</div>
      <div class="hint" style="margin-top:6px;">
        Remaining: <b>${round0(Math.max(remaining.calories,0))} kcal</b> •
        P <b>${round1(Math.max(remaining.protein,0))}g</b> •
        C <b>${round1(Math.max(remaining.carbs,0))}g</b> •
        F <b>${round1(Math.max(remaining.fat,0))}g</b>
      </div>

      <div class="hr"></div>

      <div class="row">
        <div class="field grow">
          <label>Optimize suggestions for</label>
          <select id="preferSel">
            <option value="balanced" ${prefer==="balanced"?"selected":""}>Balanced</option>
            <option value="protein" ${prefer==="protein"?"selected":""}>Protein</option>
            <option value="carbs" ${prefer==="carbs"?"selected":""}>Carbs</option>
            <option value="fat" ${prefer==="fat"?"selected":""}>Fat</option>
          </select>
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn primary" id="btnGenPlan">Generate meal plan 💡</button>
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn ghost" id="btnClearPlan">Clear plan</button>
        </div>
      </div>

      <div class="subTitle">What should I eat next? (per ~100g)</div>
      <div class="hint" style="margin-top:8px;">
        ${suggestions.map(s =>
          `• <b>${escapeHtml(s.name)}</b> — ${round0(s.per100g.calories)} kcal | P ${round1(s.per100g.protein)} | C ${round1(s.per100g.carbs)} | F ${round1(s.per100g.fat)}`
        ).join("<br>")}
      </div>

      <div class="hr"></div>
      <div class="subTitle">Full-day meal planner</div>
      <div id="mealPlanOut" class="hint">Tap “Generate meal plan” to build one.</div>
    `;

    $("preferSel").onchange = (e) => { prefer = e.target.value; persistUI(); renderAll(); };
    $("btnGenPlan").onclick = () => {
      const plan = generateMealPlan(goals);
      $("mealPlanOut").innerHTML = Object.entries(plan).map(([meal, items]) => `
        <div style="margin-top:10px;">
          <div style="font-weight:950;">${meal}</div>
          ${items.map(it => `<div class="hint">• ${escapeHtml(it.food)} — ~${round0(it.grams)}g</div>`).join("")}
        </div>
      `).join("");
    };
    $("btnClearPlan").onclick = () => {
      $("mealPlanOut").innerHTML = "Tap “Generate meal plan” to build one.";
    };
  }

  // Analytics
  renderAnalytics();

  // Buttons
  $("btnSearch").onclick = doSearch;
  $("btnLog").onclick = logFood;
  $("btnSaveGoals").onclick = saveGoals;
  $("btnResetDay").onclick = resetToday;

  $("btnHelp").onclick = () => {
    helpOpen = !helpOpen;
    persistUI();
    renderAll();
  };

  $("searchMode").onchange = (e) => { searchMode = e.target.value; persistUI(); };
  $("manualMode").onchange = (e) => { manualMode = e.target.checked; persistUI(); renderAll(); };

  // Enter triggers search
  $("foodQuery").onkeydown = (e) => { if (e.key === "Enter") doSearch(); };
}

function renderAnalytics() {
  const months = availableMonths();
  if (!selectedMonth) selectedMonth = months[months.length - 1] || TODAY.slice(0, 7);

  // Tabs
  $("tab7").onclick = () => { analyticsTab = "week"; persistUI(); renderAll(); };
  $("tab30").onclick = () => { analyticsTab = "month"; persistUI(); renderAll(); };
  $("tabCal").onclick = () => { analyticsTab = "calendar"; persistUI(); renderAll(); };

  $("tab7").classList.toggle("active", analyticsTab === "week");
  $("tab30").classList.toggle("active", analyticsTab === "month");
  $("tabCal").classList.toggle("active", analyticsTab === "calendar");

  const monthPicker = $("monthPicker");
  monthPicker.classList.toggle("hidden", analyticsTab !== "calendar");

  // Selector
  const sel = $("selMonth");
  sel.innerHTML = months.length
    ? months.map(m => `<option value="${m}" ${m === selectedMonth ? "selected" : ""}>${m}</option>`).join("")
    : `<option value="${TODAY.slice(0,7)}">${TODAY.slice(0,7)}</option>`;

  sel.onchange = (e) => { selectedMonth = e.target.value; persistUI(); renderAll(); };

  // Compute ranges
  const keys7 = rangeKeys(TODAY, 7);
  const keys30 = rangeKeys(TODAY, 30);
  const week = summarizeRange(keys7);
  const month30 = summarizeRange(keys30);

  const [y, m] = selectedMonth.split("-").map(Number);
  const calKeys = monthKeys(y, m);
  const cal = summarizeRange(calKeys);

  const which = analyticsTab === "week" ? week : (analyticsTab === "month" ? month30 : cal);

  // Charts
  const labels = which.perDay.map(d => d.key.slice(5)); // MM-DD
  const calVals = which.perDay.map(d => d.totals.calories);
  const pVals = which.perDay.map(d => d.totals.protein);

  drawLineChart($("chartCal"), labels, calVals);
  drawLineChart($("chartP"), labels, pVals);

  // KPI cards
  $("analyticsKpis").innerHTML = `
    ${kpiHTML("Total Calories", `${round0(which.sum.calories)}`, `Avg/day: ${round0(which.avg.calories)}`)}
    ${kpiHTML("Avg Protein", `${round0(which.avg.protein)} g`, `Total: ${round0(which.sum.protein)} g`)}
    ${kpiHTML("Avg Carbs", `${round0(which.avg.carbs)} g`, `Total: ${round0(which.sum.carbs)} g`)}
  `;
}

// ---------- SW register ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// ---------- Init UI state + first render ----------
(function init() {
  // hydrate UI state into controls
  $("searchMode").value = searchMode;
  $("manualMode").checked = manualMode;

  // goals + render
  renderAll();
})();
