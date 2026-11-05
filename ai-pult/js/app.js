/* AI-пульт собственника v2 — движок веток и интерфейс. Без зависимостей, работает и с file://. */
(() => {
  "use strict";

  const P = window.PULT;
  const EP = P.epochs;
  const DEC = P.decisions;
  const DBY = Object.fromEntries(DEC.map((d) => [d.id, d]));
  const KBY = Object.fromEntries(P.kpis.map((k) => [k.id, k]));
  const DELAY_MULT = 0.75;
  const SWAN = DEC.find((d) => d.swan);
  const SWAN_DAY = SWAN.swanDay;
  const STORE_KEY = "aipult.v2";

  // ---------- утилиты ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d = 1) => (v == null ? "—" : Number(v).toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  const signed = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "±") + num(Math.abs(v), d);
  const r1 = (v) => Math.round(v * 10) / 10;
  const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  const val = (x, s) => (typeof x === "function" ? x(s) : x);
  const optOf = (d, id) => d.options.find((o) => o.id === id);
  const epochOf = (day) => (day >= 90 ? 3 : day >= 60 ? 2 : day >= 30 ? 1 : 0);
  const decCode = (d) => (d.swan ? "⚡" : d.id.toUpperCase());
  let toastTimer;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  // =====================================================================
  //  ДВИЖОК: всё считается из choices = { id: { opt, at } }, at — эпоха решения
  // =====================================================================
  const isResolved = (c) => c && c.opt !== "defer";
  function makeS(choices, cut) {
    return { opt: (id) => (isResolved(choices[id]) && choices[id].at < cut ? choices[id].opt : "defer") };
  }
  const recOf = (d, choices) => val(d.rec, makeS(choices, d.swan ? 2 : d.epoch + 1));
  const sFor = (d, choices) => makeS(choices, d.swan ? 2 : 99);
  const multOf = (d, c) => (d.swan ? 1 : Math.pow(DELAY_MULT, Math.max(0, c.at - d.epoch)));
  const available = (d, o, choices) => !o.available || o.available(sFor(d, choices));

  function verdictOf(o, s) {
    const ratio = o.fact?.ratio ?? 1;
    let v = ratio >= 0.85 ? 2 : ratio >= 0.5 ? 1 : 0;
    if (o.risks.some((r) => val(r.happened, s) && r.dmg > 0)) v = Math.max(0, v - 1);
    return ["miss", "partial", "match"][v];
  }

  const activeEvents = (choices, e) => P.events.filter((ev) => ev.epoch <= e && ev.when(makeS(choices, ev.epoch)));

  function evaluate(choices, e) {
    const out = { kpi: {}, gained: 0, losses: 0, lossItems: [], truths: [], events: [], companies: {} };
    const evs = activeEvents(choices, e);
    out.events = evs.filter((ev) => ev.epoch === e);

    // KPI
    for (const k of P.kpis) {
      const base = k.base[e];
      let add = 0, touched = false;
      for (const d of DEC) {
        const c = choices[d.id];
        if (!isResolved(c) || c.at >= e) continue;
        const o = optOf(d, c.opt);
        const imp = o?.impact?.[k.id];
        if (imp == null) continue;
        const v = Array.isArray(imp) ? imp[e] || 0 : imp;
        if (v) { add += v * multOf(d, c); touched = true; }
      }
      for (const ev of evs) if (ev.impact?.[k.id]) { add += ev.impact[k.id]; touched = true; }
      let v = base == null ? (touched ? add : null) : base + add;
      if (v != null) {
        v = Math.max(0, v);
        if (k.id === "coverage") v = Math.min(11, Math.round(v));
        if (k.id === "ai_accuracy") v = Math.min(99, Math.round(v));
        out.kpi[k.id] = r1(v);
      } else out.kpi[k.id] = null;
    }

    // эффект и потери
    for (const d of DEC) {
      if (d.final) continue;
      const c = choices[d.id];
      const resolvedBefore = isResolved(c) && c.at < e;
      // цена отсрочки
      if (!d.swan && d.delayCost && d.epoch < e) {
        const until = isResolved(c) ? Math.min(c.at, e) : e;
        const months = until - d.epoch;
        if (months > 0) out.lossItems.push({ id: d.id, kind: "delay", label: `${decCode(d)} отложено на ${months} мес`, rub: d.delayCost * months });
      }
      if (!resolvedBefore) continue;
      const o = optOf(d, c.opt);
      const s = sFor(d, choices);
      const mult = multOf(d, c);
      const ratio = o.fact?.ratio ?? 1;
      out.gained += (o.effect || 0) * mult * ratio;
      if (o.cost) out.lossItems.push({ id: d.id, kind: "cost", label: `${decCode(d)} · ${o.label}`, rub: val(o.cost, s) });
      for (const r of o.risks) if (val(r.happened, s) && r.dmg) out.lossItems.push({ id: d.id, kind: "risk", label: `${decCode(d)} · ${r.t}`, rub: r.dmg });
      out.truths.push({ d, o, c, mult, ratio, verdict: verdictOf(o, s), s });
    }
    for (const ev of evs) {
      const dmg = val(ev.dmg, makeS(choices, ev.epoch));
      if (dmg) out.lossItems.push({ kind: "event", label: (ev.feed && !Array.isArray(ev.feed) ? ev.feed.text : ev.brief?.title) || "Событие", rub: dmg });
    }
    out.losses = out.lossItems.reduce((a, x) => a + x.rub, 0);
    out.gained = r1(out.gained);
    out.losses = r1(out.losses);
    out.net = r1(out.gained - out.losses);
    out.matched = out.truths.filter((t) => t.verdict === "match").length;

    // статусы компаний
    for (const co of P.companies) out.companies[co.id] = { status: co.status, note: "" };
    for (const ev of evs) if (ev.company) out.companies[ev.company.id] = { status: ev.company.status, note: ev.company.note };
    return out;
  }

  // Рекомендованный путь: каждое решение — рекомендация пульта в свой месяц
  function recommendedChoices() {
    const ch = {};
    for (const d of [...DEC].sort((a, b) => a.epoch - b.epoch || (a.swan ? 1 : 0) - (b.swan ? 1 : 0))) {
      ch[d.id] = { opt: recOf(d, ch), at: d.epoch };
    }
    return ch;
  }

  function cashSeries(choices) {
    const s = makeS(choices, 2);
    const bs = s.opt(SWAN.id);
    const early = s.opt("d04") === "B";
    if (bs === "defer") return { main: P.cash.none, ghost: null, early };
    const set = early ? P.cash.early : P.cash.late;
    return { main: set[bs] || P.cash.early[bs], ghost: P.cash.none, early };
  }

  // =====================================================================
  //  СОСТОЯНИЕ
  // =====================================================================
  let state = { choices: {}, day: 0, swanShown: false, swanSeen: false };
  let tab = "cockpit";
  let selectedNode = null; // для «что если» в дереве
  let lastCounters = { gained: 0, losses: 0 };
  const flippedOnce = new Set();

  const cur = () => epochOf(state.day);

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* приватный режим */ }
  }
  function encodeHash() {
    const parts = Object.entries(state.choices).filter(([, c]) => isResolved(c)).map(([id, c]) => `${id}.${c.opt}.${c.at}`);
    return `#s=${parts.join("-")}&d=${state.day}`;
  }
  function loadState() {
    const h = location.hash.match(/s=([^&]*)&d=(\d+)/);
    if (h) {
      const choices = {};
      for (const p of h[1].split("-").filter(Boolean)) {
        const [id, opt, at] = p.split(".");
        if (DBY[id] && optOf(DBY[id], opt)) choices[id] = { opt, at: +at };
      }
      state = { choices, day: Math.min(90, +h[2]), swanShown: true, swanSeen: +h[2] >= SWAN_DAY };
      return;
    }
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (s && s.choices) state = { ...state, ...s };
    } catch { /* пусто */ }
  }

  // =====================================================================
  //  РЕНДЕР
  // =====================================================================
  function render() {
    const e = cur();
    const ev = evaluate(state.choices, e);
    renderCounters(ev);
    renderTimeline();
    renderHero(ev);
    renderTabs();
    if (tab === "cockpit") renderCockpit(ev);
    if (tab === "decisions") renderDecisions(ev);
    if (tab === "tree") renderTree();
    if (tab === "system") renderSystem();
    if (tab === "group") renderGroup(ev);
    if (tab === "report") renderReport();
    save();
  }

  // ---------- счётчики ----------
  function animateNum(el, from, to, d = 1) {
    if (!el) return;
    const t0 = performance.now(), dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = num(from + (to - from) * e, d);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderCounters(ev) {
    const pending = pendingDecisions().length;
    const total = ev.truths.length;
    $("#counters").innerHTML = `
      <div class="ctr ctr--good"><div class="ctr__label">Эффект решений · факт</div>
        <div class="ctr__value"><span id="cGained">${num(lastCounters.gained)}</span><small>млн ₽/год</small></div>
        <div class="ctr__sub">с учётом того, что сбылось <span class="tag tag--model">модель</span></div></div>
      <div class="ctr ctr--bad ${ev.losses > lastCounters.losses ? "flash" : ""}" id="cLossBox"><div class="ctr__label">Цена бездействия и ошибок</div>
        <div class="ctr__value"><span id="cLoss">${num(lastCounters.losses)}</span><small>млн ₽</small></div>
        <div class="ctr__sub">${ev.lossItems.length ? esc(ev.lossItems.slice().sort((a, b) => b.rub - a.rub)[0].label) : "пока без потерь"}</div></div>
      <div class="ctr ctr--acc"><div class="ctr__label">Прогнозы пульта сбылись</div>
        <div class="ctr__value">${total ? `${ev.matched}<small>из ${total}</small>` : `—<small>ждём факта</small>`}</div>
        <div class="ctr__sub">${total ? `точность ${Math.round((ev.matched / total) * 100)}%` : "проверка — через месяц после решения"}</div></div>
      <div class="ctr"><div class="ctr__label">Ждут решения</div>
        <div class="ctr__value" style="color:${pending ? "var(--yellow)" : "var(--green)"}">${pending}<small>${pending ? "в " + EP[cur()].code : "всё решено"}</small></div>
        <div class="ctr__sub">${pending ? "каждый месяц отсрочки стоит денег" : "можно двигаться дальше"}</div></div>`;
    animateNum($("#cGained"), lastCounters.gained, ev.gained);
    animateNum($("#cLoss"), lastCounters.losses, ev.losses);
    setTimeout(() => $("#cLossBox")?.classList.remove("flash"), 900);
    lastCounters = { gained: ev.gained, losses: ev.losses };
  }

  // ---------- таймлайн ----------
  const pct = (day) => (day / 90) * 100;
  function renderTimeline() {
    const e = cur();
    $("#timeline").innerHTML = `
      <div class="tl__track" id="tlTrack">
        <div class="tl__fill" style="width:${pct(state.day)}%"></div>
        <div class="tl__head" style="left:${pct(state.day)}%"></div>
      </div>
      ${EP.map((ep, i) => `
        <button class="tl__stop ${i < e ? "is-past" : ""} ${i === e ? "is-cur" : ""}" data-epoch="${i}" style="left:calc(30px + (100% - 60px) * ${ep.day / 90})" aria-label="${ep.code}, день ${ep.day}">
          <b>${ep.code}</b><i></i><small>День ${ep.day} · ${fmtDate(ep.date).slice(0, 5)}</small>
        </button>`).join("")}
      ${state.swanSeen ? `<button class="tl__swan" data-swan="1" title="День ${SWAN_DAY}: город задержал оплату" style="left:calc(30px + (100% - 60px) * ${SWAN_DAY / 90})">⚡</button>` : ""}`;
  }
  function setPlayhead(day) {
    const fill = $(".tl__fill"), head = $(".tl__head");
    if (fill) fill.style.width = pct(day) + "%";
    if (head) head.style.left = pct(day) + "%";
  }

  // ---------- hero ----------
  const STATE_LABEL = { offline: ["Пульт не подключён", "grey"], audit: ["Аудит", "yellow"], integrating: ["Интеграция данных", "yellow"], live: ["Пульт в работе", "green"] };
  function renderHero(ev) {
    const e = cur();
    const ep = EP[e];
    const hl = [...ev.events].reverse().find((x) => x.headline)?.headline || ep.headline;
    const alert = hl !== ep.headline;
    const [stLabel, stColor] = STATE_LABEL[ep.state];
    $("#hero").className = "hero" + (alert ? " hero--alert" : "");
    $("#hero").innerHTML = `
      <div class="hero__inner">
        <div class="hero__num">${esc(ep.code)}</div>
        <div>
          <div class="hero__kicker">
            <b>${esc(ep.title)}</b>
            <span class="state"><i class="dot dot--${stColor}"></i>${stLabel}</span>
            <span id="heroDay">День ${state.day} · неделя ${ep.week} из 13 · ${fmtDate(ep.date)}</span>
            ${alert ? '<span class="tag tag--bad">ветка ваших решений</span>' : ""}
          </div>
          <h2>${esc(hl)}</h2>
          <p>${esc(ep.summary)}</p>
        </div>
      </div>`;
    $("#groupName").textContent = P.meta.group;
    $("#sources").textContent = "Источники: " + P.meta.sources;
  }

  function renderTabs() {
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== "tab-" + tab));
    const n = pendingDecisions().length;
    $("#decBadge").textContent = n || "";
  }

  // ---------- пульт ----------
  function fill(text, ev) {
    const bs = state.choices[SWAN.id];
    const cash = cashSeries(state.choices).main;
    return text
      .replace("{bsLabel}", isResolved(bs) ? optOf(SWAN, bs.opt).label : "")
      .replace("{cash}", num(cash[12]))
      .replace(/\{(\w+)\}/g, (m, id) => (ev.kpi[id] != null ? num(ev.kpi[id]) : m));
  }
  const flat = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const LV = { critical: 0, warn: 1, info: 2, ok: 3 };
  const dateKey = (d) => { const [dd, mm] = d.split(".").map(Number); return (mm < 7 ? mm + 12 : mm) * 40 + dd; };

  function renderCockpit(ev) {
    const e = cur();
    const ep = EP[e];
    const brief = [...ev.events.flatMap((x) => flat(x.brief).map((b) => ({ ...b, branch: true }))), ...ep.brief].sort((a, b) => LV[a.level] - LV[b.level]);
    const feed = [...ev.events.flatMap((x) => flat(x.feed).map((f) => ({ ...f, branch: true }))), ...ep.feed].sort((a, b) => dateKey(b.date) - dateKey(a.date));
    const tg = [...ep.tg, ...ev.events.flatMap((x) => flat(x.tg))].filter((m) => fill(m.text, ev).trim());

    const kpiHtml = P.kpis.map((k) => kpiCard(k, ev)).join("");
    const cs = e >= 2 ? cashSeries(state.choices) : null;

    $("#tab-cockpit").innerHTML = `
      <div class="grid grid--cockpit">
        <div class="card">
          <div class="card__head"><h3>Что требует внимания</h3><span class="label">по деньгам под риском</span></div>
          <div class="brief">${brief.map((b, i) => `
            <div class="brief__item brief__item--${b.level}" style="animation-delay:${i * 0.06}s">
              <div><div class="brief__title">${esc(b.title)}</div>
              <div class="brief__meta">${esc(b.source)}${b.action && b.action !== "—" ? ` · <b>${esc(b.action)}</b>` : ""}${b.branch ? ' · <span style="color:var(--violet)">следствие ваших решений</span>' : ""}</div></div>
              <div class="brief__rub">${b.rub != null ? num(b.rub) + "<small>млн ₽</small>" : ""}</div>
            </div>`).join("")}</div>
        </div>
        <div class="card">
          <div class="card__head"><h3>Telegram-бот собственника</h3><span class="label">${ep.state === "live" ? "в работе" : "тест"}</span></div>
          <div class="phone"><div class="phone__screen">
            <div class="phone__bar"><div class="logo"><span>П</span><i></i></div><div><b>AI-пульт</b><small>${ep.state === "offline" ? "подключается…" : "онлайн"}</small></div></div>
            <div class="chat">${tg.map((m, i) => `<div class="msg msg--${m.from}" style="animation-delay:${i * 0.35}s">${esc(fill(m.text, ev))}<time>${esc(m.time)}</time></div>`).join("")}</div>
          </div></div>
        </div>
      </div>

      <div class="section-title"><h3>Ключевые показатели</h3><span class="muted" style="font-size:13px">цвет — расстояние до цели этапа</span></div>
      <div class="kpis">${kpiHtml}</div>

      <div class="grid grid--2" style="margin-top:16px">
        <div class="card">
          <div class="card__head"><h3>Остаток денег группы · 13 недель</h3>${cs ? `<span class="tag ${cs.early ? "tag--accent" : "tag--warn"}">${cs.early ? "платёжный календарь · 1С" : "ручная оценка финслужбы"}</span>` : ""}</div>
          ${cs ? cashChart(cs, ep.week) : `<div class="empty">Данные 1С ещё не подключены.<br>Сейчас остаток — ручная оценка финслужбы раз в неделю.<br><b>График появится на дне 60.</b></div>`}
        </div>
        <div class="card">
          <div class="card__head"><h3>Риск-радар</h3><span class="label">ЕГРЮЛ · ФНС · КАД · ФССП · ЕИС</span></div>
          <div class="feed">${feed.map((r, i) => {
            const color = { critical: "red", warn: "yellow", ok: "green", info: "" }[r.level] || "";
            return `<div class="feed__item ${r.branch ? "feed__item--branch" : ""}" style="animation-delay:${i * 0.05}s"><span class="feed__date">${esc(r.date)}</span><i class="dot ${color ? "dot--" + color : ""}"></i>
              <div><div class="feed__src">${esc(r.source)} · ${esc(r.entity)} ${r.model ? '<span class="tag tag--model">модель</span>' : ""}</div><div class="feed__text">${esc(r.text)}</div></div></div>`;
          }).join("")}</div>
        </div>
      </div>`;
  }

  function kpiStatus(k, v) {
    if (v == null) return "na";
    const t = k.target;
    if (k.better === "lower") return v <= t ? "ok" : v <= (t === 0 ? 1 : t * 1.5) ? "warn" : "bad";
    return v >= t ? "ok" : v >= t * 0.8 ? "warn" : "bad";
  }
  function kpiCard(k, ev) {
    const e = cur();
    const v = ev.kpi[k.id];
    const st = kpiStatus(k, v);
    let delta = "";
    if (e > 0) {
      const prev = evaluate(state.choices, e - 1).kpi[k.id];
      if (v != null && prev != null && v !== prev) {
        const good = k.better === "lower" ? v < prev : v > prev;
        delta = `<span class="${good ? "delta--good" : "delta--bad"}">${signed(v - prev)} к ${EP[e - 1].code}</span>`;
      }
    }
    // что дадут решения этого месяца в следующем
    let proj = "";
    if (e < 3) {
      const without = { ...state.choices };
      for (const [id, c] of Object.entries(without)) if (c.at === e) delete without[id];
      const a = evaluate(state.choices, e + 1).kpi[k.id], b = evaluate(without, e + 1).kpi[k.id];
      if (a != null && b != null && a !== b) proj = `<div class="kpi__proj">→ решения ${EP[e].code}: ${signed(a - b)} к ${EP[e + 1].code}</div>`;
      if (a != null && b == null) proj = `<div class="kpi__proj">→ решения ${EP[e].code}: появится в ${EP[e + 1].code}</div>`;
    }
    return `
      <div class="kpi kpi--${st}">
        <div class="kpi__label">${esc(k.label)} ${k.model ? '<span class="tag tag--model">модель</span>' : ""}</div>
        <div class="kpi__value ${v == null ? "kpi__value--na" : ""}">${v == null ? "нет данных" : num(v)}${v == null ? "" : `<small>${esc(k.unit)}</small>`}</div>
        <div class="kpi__row"><span>цель ${num(k.target)} ${esc(k.unit)}</span>${delta}</div>
        ${proj}
      </div>`;
  }

  function cashChart(cs, nowWeek, opts = {}) {
    const W = 640, H = opts.h || 240, pl = 40, pr = 12, pt = 14, pb = 26;
    const series = [cs.main, cs.ghost].filter(Boolean);
    const all = [...series.flat(), 0, P.cash.threshold];
    const max = Math.ceil(Math.max(...all) / 10) * 10, min = Math.floor(Math.min(...all) / 10) * 10;
    const x = (i) => pl + (i * (W - pl - pr)) / 12;
    const y = (v) => pt + ((max - v) * (H - pt - pb)) / (max - min);
    const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    let grid = "";
    for (let v = min; v <= max; v += 10) grid += `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 7}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    const labels = cs.main.map((_, i) => `<text x="${x(i)}" y="${H - 7}" text-anchor="middle">${i + 1}</text>`).join("");
    const pts = cs.main.map((v, i) => `<circle class="pt ${v < P.cash.threshold ? "pt--neg" : ""}" cx="${x(i)}" cy="${y(v)}" r="${v < 0 ? 5.5 : 3}"><title>Неделя ${i + 1}: ${num(v)} млн ₽</title></circle>`).join("");
    const rough = !cs.early && !opts.swan;
    return `
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Остаток денег группы по неделям">
        <defs><linearGradient id="gradA" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4cc9f0" stop-opacity=".25"/><stop offset="1" stop-color="#4cc9f0" stop-opacity="0"/></linearGradient></defs>
        ${grid}
        <line class="zero" x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}"/>
        <line class="threshold" x1="${pl}" x2="${W - pr}" y1="${y(P.cash.threshold)}" y2="${y(P.cash.threshold)}"/>
        ${nowWeek ? `<line class="nowline" x1="${x(nowWeek - 1)}" x2="${x(nowWeek - 1)}" y1="${pt}" y2="${H - pb}"/>` : ""}
        <path class="area" d="${path(cs.main)}L${x(12)},${y(min)}L${x(0)},${y(min)}Z"/>
        ${cs.ghost ? `<path class="line line--ghost" d="${path(cs.ghost)}"/>` : ""}
        <path class="line ${rough ? "line--rough" : ""}" d="${path(cs.main)}" ${opts.swan ? 'style="stroke:var(--red)"' : ""}/>
        ${pts}${labels}
      </svg>
      <div class="legend">
        <span><i ${opts.swan ? 'style="background:var(--red)"' : ""}></i>${opts.swan ? "Если ничего не делать" : "Остаток, млн ₽ · неделя проекта"}</span>
        ${cs.ghost ? `<span><i class="ghost"></i>Без реакции на задержку</span>` : ""}
        <span><i class="thr"></i>Порог безопасности ${P.cash.threshold} млн ₽</span>
      </div>`;
  }

  // ---------- решения ----------
  // В месяце e показываем: решения этого месяца + отложенные из прошлых (кроме принятых раньше)
  function visibleDecisions(e = cur()) {
    return DEC.filter((d) => {
      if (d.epoch > e) return false;
      if (d.swan && e === 1 && state.day < SWAN_DAY) return false;
      const c = state.choices[d.id];
      return !(isResolved(c) && c.at < e);
    });
  }
  const pendingDecisions = () => visibleDecisions().filter((d) => !isResolved(state.choices[d.id]));

  function optionTile(d, o, chosen, rec, ctx = "dec") {
    const off = !available(d, o, state.choices);
    const s = sFor(d, state.choices);
    const cost = o.cost ? val(o.cost, s) : 0;
    const eff = d.swan
      ? `<span class="opt__eff opt__eff--cost">стоимость ≈ ${num(cost)} млн ₽</span>`
      : o.effect ? `<span class="opt__eff">+${num(o.effect)} млн ₽/год</span>` : `<span class="opt__eff opt__eff--zero">эффект 0</span>`;
    const r = o.risks[0];
    return `
      <button class="opt ${chosen ? "is-on" : ""} ${off ? "is-off" : ""}" data-ctx="${ctx}" data-dec="${d.id}" data-opt="${o.id}" ${off ? 'aria-disabled="true"' : ""} aria-pressed="${chosen}">
        ${rec ? '<span class="opt__rec">РЕКОМЕНДАЦИЯ</span>' : ""}<span class="opt__check"></span>
        <span class="opt__label">${esc(o.label)}</span>
        ${eff}
        ${off ? `<span class="opt__why">✕ ${esc(d.unavailableWhy || o.unavailableWhy || "Недоступно")}</span>` : r ? `<span class="opt__risk">риск: ${esc(r.t.toLowerCase())} · ${r.p}%</span>` : ""}
      </button>`;
  }

  function riskBlock(o) {
    if (!o?.risks?.length) return "";
    return `<div class="dec__risk"><h4>Что может пойти не так · «${esc(o.label)}»</h4>${o.risks.map((r) => `
      <div class="risk">
        <div class="risk__t">${esc(r.t)}</div><div class="risk__p">${r.p}%</div>
        <div class="meter"><i style="width:${r.p}%"></i></div>
        <div class="risk__grid">
          <div><span>Ущерб, если сбудется</span>${r.dmg ? num(r.dmg) + " млн ₽" : "без прямых потерь"}</div>
          <div><span>Ранний сигнал</span>${esc(r.signal)}</div>
          <div><span>План Б</span>${esc(r.plan)}</div>
        </div>
      </div>`).join("")}</div>`;
  }

  function decisionCard(d) {
    const e = cur();
    const c = state.choices[d.id];
    const chosen = isResolved(c) ? c.opt : null;
    const rec = recOf(d, state.choices);
    const carried = d.epoch < e && !d.swan;
    const shown = optOf(d, chosen || rec);
    const months = e - d.epoch;
    return `
      <article class="dec ${d.swan ? "dec--swan" : ""} ${carried ? "dec--carried" : ""}" id="dec-${d.id}">
        <div class="dec__head">
          <div><span class="dec__id">${decCode(d)}</span><span class="dec__title">${esc(d.title)}</span></div>
          <div class="dec__tags"><span class="tag tag--accent">${esc(d.area)}</span>${d.model ? '<span class="tag tag--model">модель</span>' : ""}${d.swan ? '<span class="tag tag--bad">срочно</span>' : ""}</div>
        </div>
        ${carried ? `<div class="dec__carry">⏳ Отложено с ${EP[d.epoch].code}: уже стоило ${num(d.delayCost * months)} млн ₽, эффект теперь ×${num(Math.pow(DELAY_MULT, months), 2)}</div>` : ""}
        <dl class="dec__sig">
          <dt>Сигнал</dt><dd>${esc(d.signal)}</dd>
          <dt>Расчёт</dt><dd>${esc(d.calc)}</dd>
        </dl>
        <div class="opts">${d.options.map((o) => optionTile(d, o, chosen === o.id, rec === o.id)).join("")}</div>
        ${riskBlock(shown)}
        <div class="dec__foot">
          <span class="dec__status">${chosen ? `Решение: <b>${esc(optOf(d, chosen).label)}</b>${chosen !== rec ? " · не совпадает с рекомендацией" : " · по рекомендации"}` : c?.opt === "defer" ? "<b>Отложено вами</b>" : "Ждёт решения собственника"}</span>
          ${d.final ? "" : `<button class="btn btn--sm btn--ghost" data-defer="${d.id}">Отложить${d.delayCost ? ` · −${num(d.delayCost)} млн ₽/мес` : ""}</button>`}
        </div>
      </article>`;
  }

  function truthCard(t, i) {
    const { d, o, mult, ratio, verdict, s } = t;
    const forecast = (o.effect || 0) * mult;
    const fact = forecast * ratio;
    const vt = { match: "✅ Совпало", partial: "⚠️ Частично", miss: "❌ Не сработало" }[verdict];
    const risks = o.risks.map((r) => `<div class="risk-out">${val(r.happened, s) ? "🔴 Риск сбылся" : "🟢 Риск не сбылся"}: <b>${esc(r.outcome)}</b></div>`).join("");
    return `
      <div class="flip" data-flip="${d.id}" style="--i:${i}">
        <div class="flip__in">
          <div class="flip__face">
            <div class="flip__k">${decCode(d)} · прогноз пульта · ${EP[t.c.at].code}</div>
            <div class="flip__t">${esc(o.label)}</div>
            <div class="flip__big">${d.swan ? "Разрыв закрыт" : forecast ? "+" + num(forecast) + " млн ₽/год" : "без эффекта"}</div>
            <div class="flip__text">${esc(d.title)}</div>
            <div class="muted" style="margin-top:auto;font-size:12px">Факт раскрывается…</div>
          </div>
          <div class="flip__face flip__back flip__back--${verdict}">
            <div class="flip__k">${decCode(d)} · факт · ${EP[Math.min(3, t.c.at + 1)].code}</div>
            <div class="verdict verdict--${verdict}">${vt}${forecast ? ` · ${Math.round(ratio * 100)}% прогноза` : ""}</div>
            <div class="flip__big">${d.swan ? "Факт" : forecast ? "+" + num(fact) + " млн ₽/год" : "0"}</div>
            <div class="flip__text">${esc(o.fact?.text || "")}</div>
            ${risks}
          </div>
        </div>
      </div>`;
  }

  function renderDecisions(ev) {
    const e = cur();
    const list = visibleDecisions(e).sort((a, b) => (b.swan ? 1 : 0) - (a.swan ? 1 : 0) || a.epoch - b.epoch);
    const truths = ev.truths.filter((t) => t.c.at === e - 1);
    const past = ev.truths.filter((t) => t.c.at < e - 1);
    $("#tab-decisions").innerHTML = `
      ${truths.length ? `
        <div class="section-title" style="margin-top:0"><h3>Момент истины · решения ${EP[e - 1].code}</h3><span class="muted" style="font-size:13px">прогноз → что случилось на самом деле</span></div>
        <div class="truths">${truths.map(truthCard).join("")}</div>` : ""}
      <div class="section-title" ${truths.length ? "" : 'style="margin-top:0"'}><h3>Решения ${EP[e].code}</h3><span class="muted" style="font-size:13px">сигнал → расчёт → варианты → риски</span></div>
      <p class="dec-intro">Выберите вариант — пульт пересчитает показатели, деньги и события следующих месяцев. Отложить тоже можно, но каждый месяц отсрочки стоит денег, а эффект решения падает на четверть.</p>
      <div class="decisions">${list.length ? list.map(decisionCard).join("") : `<div class="empty">${e === 1 && state.day < SWAN_DAY && SWAN ? "Все решения месяца приняты." : "Решений в этом месяце нет."}</div>`}</div>
      ${past.length ? `<div class="section-title"><h3>Принятые раньше</h3></div>
        <div class="past">${past.map((t) => `<div class="past__item"><span class="mono">${decCode(t.d)}</span>${esc(t.d.title)} → <b>${esc(t.o.label)}</b><span class="verdict verdict--${t.verdict}" style="margin-left:auto;font-size:12px">${{ match: "✅ совпало", partial: "⚠️ частично", miss: "❌ не сработало" }[t.verdict]}</span></div>`).join("")}</div>` : ""}`;
    // переворот карточек истины — один раз на каждую
    requestAnimationFrame(() => {
      document.querySelectorAll("[data-flip]").forEach((el, i) => {
        const key = el.dataset.flip + ":" + e;
        if (flippedOnce.has(key)) { el.classList.add("is-flipped"); return; }
        setTimeout(() => { el.classList.add("is-flipped"); flippedOnce.add(key); }, 600 + i * 350);
      });
    });
  }

  function choose(id, opt, at) {
    const d = DBY[id];
    const o = optOf(d, opt);
    if (!o || !available(d, o, state.choices)) return;
    state.choices[id] = { opt, at: at ?? cur() };
    render();
    const box = $("#dec-" + id);
    if (box) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---------- дерево событий ----------
  function treeLayout() {
    const order = [...DEC].sort((a, b) => a.epoch - b.epoch || (a.swan ? 1 : 0) - (b.swan ? 1 : 0));
    const pl = 96, step = 82, gap = 34;
    let x = pl, lastEp = 0;
    const cols = order.map((d) => {
      if (d.epoch !== lastEp) { x += gap; lastEp = d.epoch; }
      const col = { d, x };
      x += step;
      return col;
    });
    return { cols, W: x + 30 };
  }
  const ROWS = [74, 128, 182, 244]; // A, B, C, отложено

  function treePath(cols, getOpt) {
    const pts = [[40, ROWS[0] + 80]];
    for (const { d, x } of cols) {
      const o = getOpt(d);
      if (o === null) break;
      const idx = o === "defer" ? 3 : d.options.findIndex((v) => v.id === o);
      pts.push([x, ROWS[idx]]);
    }
    let p = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      p += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
    }
    return p;
  }

  function renderTree() {
    const e = cur();
    const { cols, W } = treeLayout();
    const H = 290;
    const rec = recommendedChoices();
    const visibleUntil = (d) => d.epoch < e || (d.epoch === e && (!d.swan || state.day >= SWAN_DAY)) || (d.swan && e > 1);
    const mineOpt = (d) => {
      if (!visibleUntil(d)) return null;
      const c = state.choices[d.id];
      if (isResolved(c) && c.at <= e) return c.opt;
      return d.epoch < e || (d.swan && e > 1) ? "defer" : null; // решения текущего месяца ещё не приняты — линия обрывается
    };
    // полосы эпох
    const bands = EP.map((ep, i) => {
      const cs = cols.filter((c) => c.d.epoch === i);
      if (!cs.length) return "";
      const x0 = cs[0].x - 34, x1 = cs[cs.length - 1].x + 34;
      return `<rect class="band" x="${x0}" y="20" width="${x1 - x0}" height="${H - 30}" rx="10"/><text class="band-l" x="${x0 + 10}" y="40">${ep.code} · день ${ep.day}</text>`;
    }).join("");
    const rowL = ["A", "B", "C", "отложено"].map((l, i) => `<text class="row-l" x="12" y="${ROWS[i] + 4}">${l}</text>`).join("");
    const nodes = cols.map(({ d, x }) => {
      const mine = mineOpt(d);
      const future = !visibleUntil(d);
      const r = rec[d.id].opt;
      const items = d.options.map((o, i) => {
        const off = !available(d, o, state.choices);
        const sel = selectedNode && selectedNode.id === d.id && selectedNode.opt === o.id;
        return `<g><circle class="node ${mine === o.id ? "node--mine" : ""} ${future ? "node--future" : ""} ${off ? "node--off" : ""} ${sel ? "node--sel" : ""}" cx="${x}" cy="${ROWS[i]}" r="9" data-node="${d.id}" data-opt="${o.id}" tabindex="0"><title>${esc(decCode(d) + " · " + o.label)}</title></circle>
          ${r === o.id ? `<circle class="ring" cx="${x}" cy="${ROWS[i]}" r="14"/>` : ""}</g>`;
      }).join("");
      const deferNode = d.final ? "" : `<circle class="node node--defer ${mine === "defer" ? "node--mine" : ""} ${future ? "node--future" : ""}" cx="${x}" cy="${ROWS[3]}" r="6" data-node="${d.id}" data-opt="defer"><title>${esc(decCode(d))} · отложить</title></circle>`;
      return `${items}${deferNode}<text class="dec-l" x="${x}" y="${H - 14}" text-anchor="middle" ${d.swan ? 'style="fill:var(--red)"' : ""}>${decCode(d)}</text>`;
    }).join("");
    const swanCol = cols.find((c) => c.d.swan);
    const swanMark = swanCol && (state.swanSeen || e > 1) ? `<text class="swan-l" x="${swanCol.x}" y="${ROWS[0] - 26}" text-anchor="middle">⚡ день ${SWAN_DAY}</text>` : "";

    const mineEv = evaluate(state.choices, Math.max(e, 0));
    const recEv = evaluate(rec, e);
    const diff = r1(mineEv.net - recEv.net);

    $("#tab-tree").innerHTML = `
      <div class="card">
        <div class="card__head"><h3>Дерево событий · 90 дней</h3><span class="label">нажмите на любой вариант — пульт покажет «что было бы, если»</span></div>
        <div class="tree-scroll">
          <svg class="tree" viewBox="0 0 ${W} ${H}" role="img" aria-label="Дерево решений проекта">
            ${bands}${rowL}${swanMark}
            <path class="path-rec" d="${treePath(cols, (d) => rec[d.id].opt)}"/>
            <path class="path-mine" d="${treePath(cols, mineOpt)}"/>
            ${nodes}
          </svg>
        </div>
        <div class="legend-tree">
          <span><i style="background:var(--accent)"></i>Ваш путь</span>
          <span><i style="background:repeating-linear-gradient(90deg,var(--gold) 0 5px,transparent 5px 9px)"></i>Рекомендованный путь</span>
          <span><i style="background:var(--red);height:8px;width:8px;border-radius:50%"></i>Отложено</span>
        </div>
        ${selectedNode ? whatIfHtml(selectedNode, e) : ""}
        <div class="cmp">
          <div class="cmp__col cmp__col--mine"><h4 style="margin:0 0 8px">Ваш путь · к ${EP[e].code}</h4>${cmpRows(mineEv)}</div>
          <div class="cmp__col cmp__col--rec"><h4 style="margin:0 0 8px">Рекомендованный путь · к ${EP[e].code}</h4>${cmpRows(recEv)}</div>
        </div>
        <p class="muted" style="margin:12px 0 0;font-size:14px">${e === 0 ? "Пока решения только принимаются — разница появится в М1." : diff >= 0 ? `Ваш путь не хуже рекомендованного: ${signed(diff)} млн ₽.` : `Ваш путь отстаёт от рекомендованного на <b style="color:var(--red)">${num(-diff)} млн ₽</b>. Подробности — во вкладке «Итог».`}</p>
      </div>`;
  }
  const cmpRows = (ev) => `
    <div class="cmp__row"><span>Эффект решений</span><b style="color:var(--green)">+${num(ev.gained)}</b></div>
    <div class="cmp__row"><span>Потери</span><b style="color:var(--red)">−${num(ev.losses)}</b></div>
    <div class="cmp__row"><span>Итог, млн ₽</span><b>${signed(ev.net)}</b></div>
    <div class="cmp__row"><span>Прогнозы сбылись</span><b>${ev.truths.length ? ev.matched + " из " + ev.truths.length : "—"}</b></div>`;

  function whatIfHtml(node, e) {
    const d = DBY[node.id];
    const horizon = 3;
    const alt = { ...state.choices };
    if (node.opt === "defer") delete alt[d.id];
    else alt[d.id] = { opt: node.opt, at: d.swan ? 1 : d.epoch };
    const a = evaluate(state.choices, horizon), b = evaluate(alt, horizon);
    const delta = r1(b.net - a.net);
    const label = node.opt === "defer" ? "отложить" : `«${optOf(d, node.opt).label}»`;
    const cur0 = state.choices[d.id];
    const same = (isResolved(cur0) ? cur0.opt : "defer") === node.opt && (!isResolved(cur0) || cur0.at === d.epoch || d.swan);
    // какие события появятся / исчезнут
    const textsOf = (ch) => new Map(P.events.filter((ev) => ev.when(makeS(ch, ev.epoch))).flatMap((ev) => [...flat(ev.feed), ...flat(ev.brief)].map((x) => [x.text || x.title, x.level])));
    const A = textsOf(state.choices), B = textsOf(alt);
    const good = (lv) => lv === "ok";
    // исчезновение плохого и появление хорошего — зелёным, наоборот — красным
    const gone = [...A].filter(([t]) => !B.has(t)).slice(0, 3).map(([t, lv]) => ({ t, ok: !good(lv), w: "исчезнет" }));
    const added = [...B].filter(([t]) => !A.has(t)).slice(0, 3).map(([t, lv]) => ({ t, ok: good(lv), w: "появится" }));
    const o = node.opt === "defer" ? null : optOf(d, node.opt);
    return `
      <div class="whatif">
        <h4>Что если в ${decCode(d)} «${esc(d.title)}» — ${esc(label)}?</h4>
        ${same ? `<div class="muted">Это ваш текущий выбор.</div>` : `<div style="font-size:15px">К дню 90 итог ${delta >= 0 ? `<b style="color:var(--green)">лучше на ${num(delta)} млн ₽</b>` : `<b style="color:var(--red)">хуже на ${num(-delta)} млн ₽</b>`} (${signed(a.net)} → ${signed(b.net)}).</div>`}
        ${!same && (gone.length || added.length) ? `<ul>${[...gone, ...added].map((x) => `<li style="color:var(--${x.ok ? "green" : "red"})">${x.w}: ${esc(x.t)}</li>`).join("")}</ul>` : ""}
        ${o ? `<div class="muted" style="font-size:13px;margin-top:8px">Риск варианта: ${esc(o.risks[0].t)} · ${o.risks[0].p}%</div>` : ""}
        ${same ? "" : `<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn--sm btn--primary" data-apply="${d.id}:${node.opt}">Применить этот вариант</button><button class="btn btn--sm btn--ghost" data-closewi="1">Закрыть</button></div>`}
      </div>`;
  }

  // ---------- как работает система (перенесено из v1, статусы зависят от веток) ----------
  const ST_TEXT = { none: "НЕТ", mapped: "ОПИСАНО", testing: "ТЕСТ", live: "ОНЛАЙН" };
  const ST_COLOR = { none: "#5c6780", mapped: "#4cc9f0", testing: "#f5a524", live: "#3ccb7f" };

  function renderSystem() {
    const e = cur();
    const ep = EP[e];
    const s = makeS(state.choices, e);
    const integrations = P.integrations.map((i) => ({ ...i, status: i.status(e, s) }));
    const by = (g) => integrations.filter((i) => i.group === g);
    const get = (id) => integrations.find((i) => i.id === id);
    const srcs = [...by("internal"), ...by("external")];
    const W = 1000, rowH = 34, nodeH = 26, nodeW = 200, x0 = 10, top = 40;
    const ys = srcs.map((s, i) => top + i * rowH + (s.group === "external" ? 26 : 0));
    const H = ys[ys.length - 1] + nodeH + 20;
    const hub = { x: 400, w: 190, h: 82 };
    const dwh = get("dwh"), llm = get("llm");
    const dwhY = H / 2 - hub.h / 2;
    const llmX = 650;
    const outs = by("output");
    const outX = 830, outW = 165, outH = 30, outStep = 44;
    // модули и каналы — одной колонкой; между модулями и каналами небольшой зазор
    const outYs = outs.map((o, i) => H / 2 - ((outs.length - 1) * outStep + 14) / 2 - outH / 2 + i * outStep + (o.id === "tg" || o.id === "web" ? 14 : 0));
    const tgIdx = outs.findIndex((o) => o.id === "tg");
    const linkCls = (st) => (st === "live" ? "link link--live" : st === "testing" ? "link link--testing" : "link");
    const curve = (x1, y1, x2, y2) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
    const journal = e >= 3 ? "live" : e >= 2 ? "testing" : "none";

    let links = srcs.map((s, i) => `<path class="${linkCls(s.status)}" d="${curve(x0 + nodeW, ys[i] + nodeH / 2, hub.x, dwhY + hub.h / 2)}"/>`).join("");
    links += `<path class="${linkCls(dwh.status === "live" && llm.status !== "none" ? llm.status : "none")}" d="M${hub.x + hub.w},${dwhY + hub.h / 2} L${llmX},${dwhY + hub.h / 2}"/>`;
    links += outs.map((o, i) => `<path class="${linkCls(o.status)}" d="${curve(llmX + hub.w - 40, dwhY + hub.h / 2, outX, outYs[i] + outH / 2)}"/>`).join("");
    // Журнал решений: решения собственника из бота возвращаются в ИИ-слой, через месяц — прогноз против факта
    const jY = dwhY + hub.h + 50;
    links += `<path class="${linkCls(journal)}" d="${curve(outX, outYs[tgIdx] + outH / 2, llmX + 75, jY + 20)}"/>`;
    const ev = evaluate(state.choices, e);
    const journalSub = ev.truths.length ? `прогноз → факт: ${ev.matched} из ${ev.truths.length}` : "прогноз → факт";

    const node = (s, y) => `
      <g class="node node--${s.status}">
        <rect x="${x0}" y="${y}" width="${nodeW}" height="${nodeH}"></rect>
        <circle cx="${x0 + 14}" cy="${y + nodeH / 2}" r="4" fill="${ST_COLOR[s.status]}"></circle>
        <text x="${x0 + 26}" y="${y + 17}">${esc(s.name)}</text>
        <text class="st" x="${x0 + nodeW - 8}" y="${y + 16}" text-anchor="end" fill="${ST_COLOR[s.status]}">${ST_TEXT[s.status]}</text>
        ${s.note ? `<title>${esc(s.note)}</title>` : ""}
      </g>`;
    const hubBox = (x, y, w, h, title, sub, st, note) => `
      <g class="hub ${st === "none" || st === "mapped" ? "hub--off" : ""}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}"></rect>
        <text x="${x + 16}" y="${y + 28}">${title}</text>
        <text class="sub" x="${x + 16}" y="${y + 48}">${sub}</text>
        <text class="sub" x="${x + 16}" y="${y + h - 10}" style="fill:${ST_COLOR[st]};font-weight:700;letter-spacing:.08em">● ${ST_TEXT[st]}</text>
        ${note ? `<title>${esc(note)}</title>` : ""}
      </g>`;
    const outNode = (o, y) => `
      <g class="node node--${o.status}">
        <rect x="${outX}" y="${y}" width="${outW}" height="${outH}"></rect>
        <circle cx="${outX + 14}" cy="${y + outH / 2}" r="4" fill="${ST_COLOR[o.status]}"></circle>
        <text x="${outX + 26}" y="${y + outH / 2 + 4}">${esc(o.name)}</text>
        ${o.note ? `<title>${esc(o.note)}</title>` : ""}
      </g>`;

    const svg = `
      <svg class="flow" viewBox="0 0 ${W} ${H}" role="img" aria-label="Схема потоков данных AI-пульта">
        <text class="col-title" x="${x0}" y="${top - 12}">Внутренние системы</text>
        <text class="col-title" x="${x0}" y="${ys[by("internal").length] - 8}">Внешние источники</text>
        <text class="col-title" x="${hub.x}" y="${dwhY - 14}">Ядро</text>
        <text class="col-title" x="${outX}" y="${outYs[0] - 14}">Модули пульта</text>
        <text class="col-title" x="${outX}" y="${outYs[tgIdx] - 8}">Собственник</text>
        ${links}
        ${srcs.map((s, i) => node(s, ys[i])).join("")}
        ${hubBox(hub.x, dwhY, hub.w, hub.h, "Хранилище данных", "граф группы · справочники", dwh.status, dwh.note)}
        ${hubBox(llmX, dwhY, hub.w - 40, hub.h, "ИИ-слой", "правила · RAG · агенты", llm.status, llm.note)}
        ${hubBox(llmX, jY, hub.w - 40, 74, "Журнал решений", journalSub, journal, "Каждое решение: прогноз, риски, а через месяц — что случилось на самом деле")}
        ${outs.map((o, i) => outNode(o, outYs[i])).join("")}
      </svg>`;

    const steps = [
      ["Сигнал", "Что изменилось: факт, источник, дата"],
      ["Расчёт", "Эффект в ₽ и откуда цифра"],
      ["Варианты", "2–3 действия, у каждого — своя ветка событий"],
      ["Риски", "Вероятность, ущерб, ранний сигнал, план Б"],
      ["Рекомендация", "Какой вариант советует пульт и почему"],
      ["Цена отсрочки", "Сколько стоит каждый месяц без решения"],
      ["Момент истины", "Через месяц: прогноз против факта"],
    ].map(([t, p], i) => `<div class="step"><b>${i + 1}</b><span>${t}</span><p>${p}</p></div>`).join("");

    // что в схеме зависит от ваших решений
    const why = [];
    if (s.opt("d03") === "A") why.push("Реестры онлайн с М1 — вы запустили риск-радар сразу (D03).");
    else if (e >= 1) why.push("Реестры ещё в тесте — риск-радар не запущен сразу (D03).");
    if (e >= 2 && s.opt("d07") === "defer") why.push("ИИ-слой не подключён — не выбраны модель и хостинг (D07).");
    if (e >= 2 && s.opt("d07") === "C") why.push("ИИ-слой отстаёт — сервер приехал на 3 недели позже (D07).");
    if (e >= 2 && s.opt("d04") === "B") why.push("Банки онлайн — это основа платёжного календаря (D04).");
    if (e >= 2 && s.opt("d04") !== "B") why.push("Банки только в тесте — платёжный календарь не выбран (D04).");
    if (e >= 2 && s.opt("d04") === "A") why.push("Вместо платёжного календаря включены голосовые поручения (D04).");
    if (e >= 2 && s.opt("d01") !== "A") why.push("Прочие юрлица отстают — не везде есть ответственные за данные (D01).");
    if (e >= 3) why.push(s.opt("d08") === "A" ? "Автопретензии работают (D08)." : "Автопретензии не включены (D08).");
    if (e >= 3) why.push(s.opt("d09") === "A" ? "Модуль тендеров ищет заказы вне г. N (D09)." : "Модуль тендеров не включён — зависимость от города осталась (D09).");

    const live = integrations.filter((i) => i.status === "live").length;
    $("#tab-system").innerHTML = `
      <div class="card">
        <div class="card__head"><h3>Потоки данных в ${esc(ep.code)}</h3><span class="label">онлайн: ${live} из ${integrations.length}</span></div>
        <div class="flow-scroll">${svg}</div>
        <div class="legend-flow">
          <span><i style="border-color:${ST_COLOR.live}"></i>Онлайн</span>
          <span><i style="border-color:${ST_COLOR.testing}"></i>Тест</span>
          <span><i style="border-color:${ST_COLOR.mapped};border-style:dashed"></i>Описано в аудите</span>
          <span><i style="border-color:${ST_COLOR.none}"></i>Не подключено</span>
          <span>Наведите на узел — подробности</span>
        </div>
        ${why.length ? `<div class="flow-why">${why.map((w) => `<div>↳ ${esc(w)}</div>`).join("")}</div>` : ""}
      </div>
      <div class="section-title"><h3>Как пульт формулирует совет</h3><span class="muted">единый стандарт для каждого решения</span></div>
      <div class="steps">${steps}</div>
      <div class="grid grid--3" style="margin-top:16px">
        <div class="card"><div class="label">Принцип 1</div><h3 style="margin:6px 0">Цифры только из данных</h3><p class="muted" style="margin:0">ИИ не придумывает числа: у каждой цифры есть источник — 1С, банк или реестр.</p></div>
        <div class="card"><div class="label">Принцип 2</div><h3 style="margin:6px 0">Деньги — только через человека</h3><p class="muted" style="margin:0">Пульт рекомендует и ставит задачи, но платежи без подтверждения собственника не проводит.</p></div>
        <div class="card"><div class="label">Принцип 3</div><h3 style="margin:6px 0">Пульт проверяет себя</h3><p class="muted" style="margin:0">Каждый прогноз через месяц сверяется с фактом. Точность видна собственнику — доверие считается, а не обещается.</p></div>
      </div>`;
  }

  // ---------- группа ----------
  function renderGroup(ev) {
    const byDir = {};
    for (const co of P.companies) (byDir[co.dir] ||= []).push(co);
    $("#tab-group").innerHTML = Object.entries(byDir).map(([dir, list]) => `
      <div class="section-title" style="margin-top:${dir === P.companies[0].dir ? 0 : 26}px"><h3>${esc(dir)}</h3><span class="muted" style="font-size:13px">${list.length} юрлиц</span></div>
      <div class="companies">${list.map((co) => {
        const st = ev.companies[co.id];
        return `<div class="co co--${st.status}">
          <div class="co__head"><span class="co__name">${esc(co.name)}</span><i class="dot dot--${st.status}"></i></div>
          <div class="co__meta">${esc(co.city)}${co.revenue != null ? ` · выручка ${num(co.revenue)} млн ₽` : ""}</div>
          <div class="co__facts">${esc(co.facts)}</div>
          ${st.note ? `<div class="co__note co__note--${st.status}">${esc(st.note)}</div>` : ""}
        </div>`;
      }).join("")}</div>`).join("");
  }

  // ---------- итог ----------
  function renderReport() {
    const rec = recommendedChoices();
    const mine = evaluate(state.choices, 3), best = evaluate(rec, 3);
    const diff = r1(mine.net - best.net);
    // главные причины разницы: заменить одно решение на рекомендованное
    // рекомендация берётся с учётом ваших прошлых выборов (например, без платёжного календаря перенос платежей недоступен)
    const drivers = DEC.filter((d) => !d.final).map((d) => {
      const c = state.choices[d.id];
      const r = { opt: recOf(d, state.choices), at: d.swan ? 1 : d.epoch };
      if (isResolved(c) && c.opt === r.opt && (c.at === r.at || d.swan)) return null;
      const alt = { ...state.choices, [d.id]: r };
      const delta = r1(evaluate(alt, 3).net - mine.net);
      return delta > 0.05 ? { d, delta, recOpt: r.opt, mineLabel: isResolved(c) ? optOf(d, c.opt).label + (c.at > d.epoch && !d.swan ? ` (с опозданием в ${c.at - d.epoch} мес)` : "") : "не принято" } : null;
    }).filter(Boolean).sort((a, b) => b.delta - a.delta).slice(0, 4);
    const notDone = DEC.filter((d) => !d.final && !isResolved(state.choices[d.id])).length;
    const head = cur() < 3 || notDone
      ? `<p>⏳ Сейчас ${EP[cur()].code}. Отчёт считает до дня 90: непринятые решения (${notDone}) учтены как отложенные.</p>` : "";
    const verdictLine = diff >= -0.05
      ? "Вы прошли 90 дней не хуже рекомендаций пульта."
      : `Ваш путь на ${num(-diff)} млн ₽ хуже рекомендованного.`;
    const kt = [
      ["Остаток денег группы — за ≤ 1 мин", mine.kpi.cash_time != null && mine.kpi.cash_time <= 1, num(mine.kpi.cash_time) + " мин"],
      ["Риск-радар: о событии — за ≤ 1 день", mine.kpi.risk_lag <= 1, num(mine.kpi.risk_lag) + " дн"],
      ["Точность ответов ИИ ≥ 85%", (mine.kpi.ai_accuracy ?? 0) >= 85, mine.kpi.ai_accuracy == null ? "нет ИИ" : mine.kpi.ai_accuracy + "%"],
      ["Подключено ≥ 10 юрлиц из 11", mine.kpi.coverage >= 10, num(mine.kpi.coverage) + " из 11"],
      ["Поручения в срок ≥ 73%", mine.kpi.tasks_on_time >= 73, num(mine.kpi.tasks_on_time) + "%"],
      ["Кассовый разрыв не допущен", makeS(state.choices, 2).opt(SWAN.id) !== "defer", makeS(state.choices, 2).opt(SWAN.id) !== "defer" ? "закрыт" : "был"],
    ];
    const ktPass = kt.filter((k) => k[1]).length;
    const d10 = state.choices.d10;

    $("#tab-report").innerHTML = `
      <div class="rep-hero">
        <div class="label">ИТОГ 90 ДНЕЙ · ${esc(P.meta.group)}</div>
        <h2 style="margin-top:6px">${verdictLine}</h2>
        ${head}
        <div class="rep-big">
          <div class="ctr ctr--good"><div class="ctr__label">Эффект решений · факт</div><div class="ctr__value">+${num(mine.gained)}<small>млн ₽/год</small></div><div class="ctr__sub">рекомендованный путь: +${num(best.gained)}</div></div>
          <div class="ctr ctr--bad"><div class="ctr__label">Потери и цена отсрочек</div><div class="ctr__value">−${num(mine.losses)}<small>млн ₽</small></div><div class="ctr__sub">рекомендованный путь: −${num(best.losses)}</div></div>
          <div class="ctr ctr--acc"><div class="ctr__label">Прогнозы пульта сбылись</div><div class="ctr__value">${mine.matched}<small>из ${mine.truths.length}</small></div><div class="ctr__sub">контрольная точка 3: ${ktPass} из ${kt.length}</div></div>
        </div>
        ${drivers.length ? `<h3 style="margin-top:20px;font-size:16px">Что сильнее всего отделило вас от лучшего пути</h3>
          <ul class="drivers">${drivers.map((x) => `<li><span><b class="mono" style="color:var(--accent)">${decCode(x.d)}</b> ${esc(x.d.title)} — вы: «${esc(x.mineLabel)}», пульт: «${esc(optOf(x.d, x.recOpt).label)}»</span><b style="color:var(--red)">−${num(x.delta)} млн ₽</b></li>`).join("")}</ul>` : ""}
        <div class="rep-actions">
          <button class="btn btn--primary" id="printBtn">Сохранить отчёт в PDF</button>
          <button class="btn" data-goto-tree="1">Открыть дерево событий</button>
        </div>
      </div>

      <div class="grid grid--2" style="margin-top:16px">
        <div class="card">
          <div class="card__head"><h3>Показатели к дню 90</h3><span class="label">вы · рекомендованный путь · цель</span></div>
          <div class="tbl-wrap"><table class="tbl" style="min-width:420px">
            <thead><tr><th>Показатель</th><th>Вы</th><th>Пульт</th><th>Цель</th></tr></thead>
            <tbody>${P.kpis.map((k) => {
              const a = mine.kpi[k.id], b = best.kpi[k.id], st = kpiStatus(k, a);
              return `<tr><td>${esc(k.label)}</td><td class="num" style="color:${st === "ok" ? "var(--green)" : st === "warn" ? "var(--yellow)" : st === "bad" ? "var(--red)" : "var(--dim)"}">${a == null ? "—" : num(a)}</td><td class="num">${b == null ? "—" : num(b)}</td><td class="num muted">${num(k.target)} ${esc(k.unit)}</td></tr>`;
            }).join("")}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card__head"><h3>Контрольная точка 3</h3><span class="label">${ktPass} из ${kt.length} критериев</span></div>
          <div class="kt">${kt.map(([t, ok, f]) => `<div class="kt__item"><i class="dot dot--${ok ? "green" : "red"}"></i>${esc(t)}<b>${esc(f)}</b></div>`).join("")}</div>
          <div class="card__head" style="margin:18px 0 8px"><h3>Этап 2</h3></div>
          <div class="muted" style="font-size:14px">${isResolved(d10) ? `Решение: <b style="color:var(--text)">${esc(optOf(DBY.d10, d10.opt).label)}</b> · потенциал ≈ ${num(optOf(DBY.d10, d10.opt).effect)} млн ₽/год <span class="tag tag--model">модель</span>` : "Решение по этапу 2 ещё не принято (вкладка «Решения» в М3)."}</div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card__head"><h3>Все решения: прогноз и факт</h3></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th></th><th>Решение</th><th>Ваш выбор</th><th>Прогноз</th><th>Факт</th><th>Итог</th></tr></thead>
          <tbody>${DEC.filter((d) => !d.final).map((d) => {
            const t = mine.truths.find((x) => x.d.id === d.id);
            const isRec = t && t.o.id === rec[d.id].opt;
            if (!t) return `<tr><td class="mono" style="color:var(--accent)">${decCode(d)}</td><td>${esc(d.title)}</td><td style="color:var(--red)">не принято</td><td class="num">—</td><td class="num">—</td><td>⏳</td></tr>`;
            const f = (t.o.effect || 0) * t.mult;
            return `<tr><td class="mono" style="color:var(--accent)">${decCode(d)}</td><td>${esc(d.title)}</td><td>${esc(t.o.label)} ${isRec ? '<span class="tag tag--gold">как советовал пульт</span>' : ""}</td>
              <td class="num">${d.swan ? "—" : "+" + num(f)}</td><td class="num">${d.swan ? "—" : "+" + num(f * t.ratio)}</td>
              <td><span class="verdict verdict--${t.verdict}" style="font-size:13px">${{ match: "✅ совпало", partial: "⚠️ частично", miss: "❌ мимо" }[t.verdict]}</span></td></tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card__head"><h3>Потери по пунктам</h3><span class="label">млн ₽ · модель</span></div>
        ${mine.lossItems.length ? `<div class="past">${mine.lossItems.slice().sort((a, b) => b.rub - a.rub).map((x) => `<div class="past__item">${esc(x.label)}<b class="mono" style="margin-left:auto;color:var(--red)">−${num(x.rub)}</b></div>`).join("")}</div>` : `<div class="empty">Потерь нет.</div>`}
      </div>`;
  }

  // =====================================================================
  //  ЧЁРНЫЙ ЛЕБЕДЬ
  // =====================================================================
  let swanResolve = null;
  function openSwan(auto = false) {
    state.swanShown = true;
    state.swanSeen = true;
    const s = makeS(state.choices, 2);
    const early = s.opt("d04") === "B";
    const rec = recOf(SWAN, state.choices);
    const c = state.choices[SWAN.id];
    const box = $("#swan");
    box.innerHTML = `
      <div class="swan__box" role="alertdialog" aria-modal="true" aria-labelledby="swanTitle">
        <div class="swan__k">⚡ День ${SWAN_DAY} · ${early ? "платёжный календарь" : "звонок финдиректора"} <span class="tag tag--model">модель</span></div>
        <h2 id="swanTitle">УЖКХ г. N перенесло оплату трёх актов: 18,4 млн ₽</h2>
        <div class="muted">${esc(SWAN.signal)}</div>
        <div class="swan__facts">
          <div class="swan__fact"><b>18,4 млн ₽</b><span>задержано городом</span></div>
          <div class="swan__fact"><b>−1,4 млн ₽</b><span>остаток на неделе 9 без реакции</span></div>
          <div class="swan__fact"><b>${early ? "9 дней" : "2 дня"}</b><span>до кассового разрыва</span></div>
        </div>
        <div class="swan__how ${early ? "swan__how--early" : "swan__how--late"}">${early
          ? "✅ Пульт увидел удар заранее: в М1 вы выбрали платёжный календарь. Доступны все три варианта."
          : "⚠️ Платёжного календаря нет (в М1 выбраны голосовые поручения) — узнали из звонка за 2 дня. Перенос платежей уже не успеть, остальное дороже."}</div>
        <div class="card" style="background:#1a1015;border-color:rgba(255,93,93,.25);padding:12px">${cashChart({ main: P.cash.none, ghost: null, early: true }, 0, { swan: true, h: 190 })}</div>
        <div class="opts">${SWAN.options.map((o) => optionTile(SWAN, o, isResolved(c) && c.opt === o.id, rec === o.id, "swan")).join("")}</div>
        <div class="swan__foot">
          <span class="muted" style="font-size:13px">Без решения: разрыв, задержка зарплаты 80 сотрудникам, ущерб ≈ 3,2 млн ₽</span>
          <button class="btn btn--ghost" id="swanLater">Решить позже</button>
        </div>
      </div>`;
    box.hidden = false;
    document.body.style.overflow = "hidden";
    if (!auto) box.querySelector(".opt:not(.is-off)")?.focus();
    return new Promise((res) => (swanResolve = res));
  }
  function closeSwan() {
    $("#swan").hidden = true;
    document.body.style.overflow = "";
    const r = swanResolve;
    swanResolve = null;
    if (r) r();
  }

  // =====================================================================
  //  НАВИГАЦИЯ ПО ВРЕМЕНИ
  // =====================================================================
  async function goToDay(target) {
    if (ap.on) return;
    const crossesSwan = state.day < SWAN_DAY && target >= SWAN_DAY;
    if (crossesSwan && !isResolved(state.choices[SWAN.id])) {
      state.day = SWAN_DAY;
      render();
      await openSwan();
    }
    state.day = target;
    render();
  }

  // =====================================================================
  //  АВТОПИЛОТ
  // =====================================================================
  const ap = { on: false, paused: false, speed: 1, stop: false };
  class Stop extends Error {}
  async function wait(ms) {
    let left = ms / ap.speed;
    while (left > 0) {
      if (ap.stop) throw new Stop();
      await new Promise((r) => setTimeout(r, 50));
      if (!ap.paused) left -= 50;
    }
    if (ap.stop) throw new Stop();
  }
  function caption(text) {
    $("#apCap").textContent = text;
    $("#apDay").textContent = "День " + state.day;
    $("#apProgress").style.width = pct(state.day) + "%";
  }
  function setTab(t) {
    tab = t;
    render();
    window.scrollTo({ top: Math.max(0, $("#tabs").offsetTop - 80), behavior: "smooth" });
  }
  async function runDays(from, to, ms, onDay) {
    const steps = to - from;
    for (let d = from + 1; d <= to; d++) {
      state.day = d;
      setPlayhead(d);
      const hd = $("#heroDay");
      if (hd) hd.textContent = hd.textContent.replace(/День \d+/, "День " + d);
      $("#apDay").textContent = "День " + d;
      $("#apProgress").style.width = pct(d) + "%";
      if (onDay && (await onDay(d))) return;
      await wait(ms / steps);
    }
  }
  async function autoDecide(e) {
    const list = visibleDecisions(e).filter((d) => !d.swan || e > 1);
    if (!list.length) return;
    setTab("decisions");
    await wait(1800);
    for (const d of list) {
      const c = state.choices[d.id];
      const opt = isResolved(c) ? c.opt : recOf(d, state.choices);
      const box = $("#dec-" + d.id);
      if (box) { box.scrollIntoView({ block: "center", behavior: "smooth" }); box.classList.add("is-auto"); }
      caption(`${decCode(d)} · ${d.title} → «${optOf(d, opt).label}»${isResolved(c) ? " (ваш выбор)" : " (рекомендация пульта)"}`);
      await wait(1700);
      state.choices[d.id] = { opt, at: isResolved(c) ? c.at : e };
      render();
      $("#dec-" + d.id)?.classList.add("is-auto");
      await wait(900);
    }
  }
  async function autopilot() {
    if (ap.on) return;
    Object.assign(ap, { on: true, paused: false, stop: false });
    $("#apbar").hidden = false;
    $("#apPause").textContent = "❚❚";
    document.body.classList.add("is-ap");
    try {
      state.day = 0;
      setTab("cockpit");
      caption("День 0. " + EP[0].headline);
      await wait(4200);
      for (let e = 0; e <= 3; e++) {
        if (e > 0) {
          setTab("cockpit");
          caption(`Идут дни… ${EP[e - 1].code} → ${EP[e].code}`);
          await runDays(EP[e - 1].day, EP[e].day, 5200, async (d) => {
            if (d === SWAN_DAY) {
              caption("⚡ День 52 — неожиданное событие");
              render();
              const p = openSwan(true);
              await wait(3800);
              const c = state.choices[SWAN.id];
              const opt = isResolved(c) ? c.opt : recOf(SWAN, state.choices);
              caption(`Реакция: «${optOf(SWAN, opt).label}»`);
              document.querySelector(`#swan .opt[data-opt="${opt}"]`)?.classList.add("is-on");
              state.choices[SWAN.id] = { opt, at: 1 };
              await wait(2200);
              closeSwan();
              await p;
            }
          });
          state.day = EP[e].day;
          render();
          const ev = evaluate(state.choices, e);
          caption(`День ${EP[e].day}. ${[...ev.events].reverse().find((x) => x.headline)?.headline || EP[e].headline}`);
          await wait(4200);
          setTab("system");
          const s = makeS(state.choices, e);
          caption(`Потоки данных ${EP[e].code}: онлайн ${P.integrations.filter((i) => i.status(e, s) === "live").length} из ${P.integrations.length}`);
          await wait(3200);
          if (ev.truths.some((t) => t.c.at === e - 1)) {
            setTab("decisions");
            caption(`Момент истины: что из решений ${EP[e - 1].code} сбылось`);
            await wait(4800);
          }
        }
        await autoDecide(e);
      }
      setTab("tree");
      caption("Весь путь: ваш маршрут против рекомендованного");
      await wait(5000);
      setTab("report");
      caption("Итог 90 дней — можно сохранить в PDF");
      await wait(3500);
    } catch (err) {
      if (!(err instanceof Stop)) throw err;
    } finally {
      ap.on = false;
      $("#apbar").hidden = true;
      document.body.classList.remove("is-ap");
      if (swanResolve) closeSwan();
      render();
    }
  }

  // =====================================================================
  //  СОБЫТИЯ ИНТЕРФЕЙСА
  // =====================================================================
  document.addEventListener("click", async (ev) => {
    const t = ev.target;
    const tabBtn = t.closest("#tabs button");
    if (tabBtn) { tab = tabBtn.dataset.tab; render(); return; }

    const opt = t.closest(".opt");
    if (opt && !ap.on) {
      if (opt.classList.contains("is-off")) { toast(DBY[opt.dataset.dec].unavailableWhy || "Вариант недоступен"); return; }
      if (opt.dataset.ctx === "swan") {
        state.choices[SWAN.id] = { opt: opt.dataset.opt, at: 1 };
        closeSwan();
        toast("Решение принято — последствия видны в М2");
        render();
        return;
      }
      choose(opt.dataset.dec, opt.dataset.opt);
      return;
    }
    if (t.closest("#swanLater") && !ap.on) { closeSwan(); toast("Решение отложено. Время идёт…"); return; }

    const def = t.closest("[data-defer]");
    if (def && !ap.on) { state.choices[def.dataset.defer] = { opt: "defer", at: cur() }; render(); toast("Отложено. Каждый месяц отсрочки стоит денег."); return; }

    const stop = t.closest(".tl__stop");
    if (stop) { await goToDay(EP[+stop.dataset.epoch].day); return; }
    if (t.closest(".tl__swan") && !ap.on) { state.day = SWAN_DAY; render(); openSwan(); return; }
    const track = t.closest("#tlTrack");
    if (track && !ap.on) {
      const rect = track.getBoundingClientRect();
      const day = ((ev.clientX - rect.left) / rect.width) * 90;
      const near = EP.reduce((a, b) => (Math.abs(b.day - day) < Math.abs(a.day - day) ? b : a));
      await goToDay(near.day);
      return;
    }

    const node = t.closest("[data-node]");
    if (node) {
      const d = DBY[node.dataset.node], o = node.dataset.opt;
      if (o !== "defer" && !available(d, optOf(d, o), state.choices)) { toast(d.unavailableWhy || "Вариант недоступен"); return; }
      selectedNode = { id: node.dataset.node, opt: o };
      render();
      $(".whatif")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    const apply = t.closest("[data-apply]");
    if (apply) {
      const [id, o] = apply.dataset.apply.split(":");
      const d = DBY[id];
      if (o === "defer") delete state.choices[id];
      else state.choices[id] = { opt: o, at: d.swan ? 1 : d.epoch };
      selectedNode = null;
      render();
      toast("Вариант применён — путь пересчитан");
      return;
    }
    if (t.closest("[data-closewi]")) { selectedNode = null; render(); return; }
    if (t.closest("[data-goto-tree]")) { tab = "tree"; render(); return; }
    if (t.closest("#printBtn")) { window.print(); return; }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("#swan").hidden && !ap.on) closeSwan();
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("[data-node]")) { ev.preventDefault(); ev.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  });

  $("#apStart").addEventListener("click", () => autopilot());
  $("#apPause").addEventListener("click", () => { ap.paused = !ap.paused; $("#apPause").textContent = ap.paused ? "▶" : "❚❚"; });
  $("#apStop").addEventListener("click", () => { ap.stop = true; });
  $("#apSpeed").addEventListener("click", () => { ap.speed = ap.speed === 1 ? 2 : ap.speed === 2 ? 4 : 1; $("#apSpeed").textContent = ap.speed + "×"; });
  $("#resetBtn").addEventListener("click", () => {
    if (ap.on) return;
    if (!confirm("Сбросить все решения и вернуться к дню 0?")) return;
    state = { choices: {}, day: 0, swanShown: false, swanSeen: false };
    selectedNode = null;
    flippedOnce.clear();
    history.replaceState(null, "", location.pathname);
    tab = "cockpit";
    render();
  });
  $("#shareBtn").addEventListener("click", async () => {
    const url = location.origin + location.pathname + encodeHash();
    try { await navigator.clipboard.writeText(url); toast("Ссылка на ваш сценарий скопирована"); }
    catch { prompt("Скопируйте ссылку:", url); }
  });

  loadState();
  render();
  // подсказка при первом входе
  if (!Object.keys(state.choices).length && state.day === 0) setTimeout(() => toast("Нажмите «▶ Автопилот 90 дней» или принимайте решения сами"), 900);
})();
