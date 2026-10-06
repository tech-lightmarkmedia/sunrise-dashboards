/* Sunrise Capital — Call Scores weekly pipeline (v1.0)
 * Runs inside a signed-in dashboards tab (https://dashboards.sunrisecapitalinvestors.com).
 *   const P = await import('/d/call-scores-pipeline.js');
 *   await P.prepare();            // finds new calls, stages the list, returns { nonce, counts }
 *   (HubSpot tab uploads transcripts with the nonce — see HUBSPOT_SNIPPET)
 *   P.score({ nonce });           // background; poll window.__CSP
 * Everything goes through /api (behind the dashboards login). Nothing here holds a secret.
 */
const API = "/api", HS = API + "/hs-api";
const CFG = {
  model: "claude-sonnet-4-6",
  fallbackModels: ["claude-sonnet-4-5", "claude-opus-4-1"],
  concurrency: 4,
  outcomesLookbackDays: 60,
  maxTokens: 2200,
};
const REPS = {
  "1750115047": { name: "Kayla Daughtrey", role: "setter" },
  "80677823": { name: "Cierra Milao", role: "setter" },
  "424254278": { name: "Bronson Picket", role: "closer" },
  "266072428": { name: "Kelvin Evans", role: "closer" },
  "650567768": { name: "Alex Zahn", role: "am" },
  "85544039": { name: "Daniel Ackerman", role: "am" },
};
const byRole = (r) => Object.keys(REPS).filter((k) => REPS[k].role === r);
const CONNECTED = {
  "f240bbac-87c9-4f6e-bf70-924b57d47db7": "Connected",
  "7858912d-4f7f-4485-96f3-8e6e6b8e0f38": "Connect - Scheduled",
};
const INTRO_TYPES = ["Intro Call - Setters", "Intro Call - Main"];
const DISCO_TYPES = ["Discovery Call - Setters", "Discovery Call - Main"];
const PIPE = { MSP: "134921120", F5: "854375554", SIF: "917379108" };
const SALES_RUBRIC = "# SCI Sandler Call Scoring Rubric (v1)\n\nContext: Sunrise Capital Investors (SCI) raises capital from individual investors for private funds (mobile home parks, parking, income fund).\n- **Intro Call** = setter (Kayla Daughtrey, Cierra Milao). Goal: qualify the prospect and book a Discovery Call with a VP (Bronson Picket / Kelvin Evans). NOT to pitch the deal in depth.\n- **Discovery Call** = VP. Goal: full Sandler Pain/Budget/Decision, present only against uncovered pain, and advance to an Investment Decision Call (or disqualify cleanly).\n\nScore each Sandler step 0-5. Evidence must come from the transcript. Do not invent.\n- 0 = absent  1 = token attempt  2 = weak  3 = adequate  4 = strong  5 = textbook Sandler\n- Use \"N/A\" only where the rubric says it is allowed for that call type.\n\n## Steps (both call types)\n1. **bonding_rapport** - Genuine rapport, matching, prospect is comfortable and talking. Not scripted chit-chat that goes nowhere.\n2. **upfront_contract** - Early in the call the rep sets: purpose, time available, what each side wants, and that \"no\" is an acceptable outcome, with agreement on what happens at the end. Missing = score 0-1.\n3. **pain** - Uses questions (not statements) to uncover WHY the prospect is looking. Sandler pain funnel: surface reason -> specifics/examples -> how long / what tried -> impact (financial/personal) -> emotional (\"how do you feel about that\"). Intro: surface + one level deeper is a 4-5. Discovery: needs impact/emotional depth for 4-5.\n4. **budget** - Qualifies money: investable amount, source of funds (IRA/1031/cash), accreditation where relevant, willingness to commit that amount. Dodged or assumed = low.\n5. **decision** - Who else is involved (spouse, advisor, CPA), how they decide, timeline, what would stop them.\n6. **next_step_contract** - Ends with a clear, mutually agreed next step (date/time + agenda), or a clean disqualification. Vague \"I'll send info\" with no commitment = 1-2.\n\n## Discovery-only (N/A on Intro)\n7. **fulfillment** - Presents the offering ONLY against pain/goals uncovered; ties features to their stated problems; checks for understanding. Generic data-dump = low.\n8. **post_sell** - Locks in the decision, surfaces buyer's remorse/back-out risks (\"what might make you change your mind?\"), confirms commitment to next step.\n\n## Behaviors (0-5, both types)\n- **talk_control** - Prospect talks more than rep; rep leads with questions. Use the transcript balance (rep talking >65% of the words on a discovery call is a problem; setters naturally talk a bit more).\n- **no_premature_presentation** - 5 = did not pitch before pain/budget/decision were known; 0 = launched into the deal pitch almost immediately. (Classic Sandler \"no free consulting\".)\n- **sandler_techniques** - Use of reversing (answering a question with a question), negative reverse selling, strips/dummy curve, \"take away\". 0 if none seen.\n\n## Flags (true/false + quote)\n- **compliance_flag** - Rep promises or strongly implies guaranteed returns, \"no risk\", guaranteed distributions, or makes specific return promises as certain. Projections clearly framed as projections are fine. Quote the line if true.\n- **disqualify_missed** - Prospect clearly not a fit (no capital, not interested, wrong goals) and rep kept pushing anyway.\n\n## Output per call (JSON object)\n{\n \"callId\": \"...\", \"callType\": \"Intro Call|Discovery Call\", \"rep\": \"...\", \"date\": \"YYYY-MM-DD\", \"durationMin\": n,\n \"scores\": {\"bonding_rapport\":n,\"upfront_contract\":n,\"pain\":n,\"budget\":n,\"decision\":n,\"next_step_contract\":n,\"fulfillment\":n|\"N/A\",\"post_sell\":n|\"N/A\",\"talk_control\":n,\"no_premature_presentation\":n,\"sandler_techniques\":n},\n \"overall\": n (0-100 = mean of numeric step+behavior scores / 5 * 100, rounded),\n \"outcome\": \"short phrase: what was agreed at end\",\n \"compliance_flag\": {\"flag\":bool,\"quote\":\"...\"},\n \"disqualify_missed\": bool,\n \"strengths\": [\"1-2 specific items with short quotes\"],\n \"coaching\": [\"1-3 specific, actionable Sandler coaching points, each tied to a moment in the call\"],\n \"best_moment\": {\"time\":\"mm:ss\",\"quote\":\"<=25 words\",\"why\":\"...\"}\n}\nKeep quotes short (<=25 words). Do NOT include investor phone numbers, emails, addresses, or account details in output. Investor first names are OK.\n\n## Addendum: \"Intro Call (unscheduled)\"\nA setter's outbound call that connected and became an intro conversation without a booked meeting. Score it with the Intro Call rules (fulfillment and post_sell = \"N/A\"). Set callType to exactly \"Intro Call (unscheduled)\". The prospect did not plan for this call, so credit a short, quick up-front contract (\"do you have a few minutes?\" plus a stated purpose) as adequate (3).\n";
const CLASSIFY = "# Classify unscheduled setter calls\n\nContext: Sunrise Capital Investors (SCI) raises capital from individual investors for private real estate funds. Setters (Kayla Daughtrey, Cierra Milao) make outbound calls. Some connected calls turn into a de-facto \"Intro Call\": the setter introduces SCI, learns about the prospect (goals, capital, timeline) and tries to book a Discovery Call with a VP. We want to score only those.\n\nFor each call (starts with '### CALL'), decide:\n- **include** - a real first/intro-style sales conversation with a prospect: the setter introduced SCI or the offering and/or asked qualifying questions, and the prospect engaged. It still counts if it ends with no booking or with a disqualification.\n- **exclude** - anything else. Pick one exclude_reason:\n  - callback_request (bad time; \"call me later\"; conversation never really starts)\n  - scheduling_only (only confirming/rescheduling an existing meeting)\n  - existing_investor (already invested with SCI; service/admin conversation)\n  - follow_up (prospect already had an intro or discovery call; this is a follow-up/nurture)\n  - not_interested_immediately (declines within the first minute or so; no real conversation)\n  - wrong_person (wrong number or not the lead)\n  - voicemail_or_no_convo (voicemail, IVR, one-sided, or dead air)\n  - internal_or_other (internal call, vendor, or not an investor conversation)\n\nAlso give a confidence (high/medium/low). Low = borderline, a person should look at it.\n\nOutput: a JSON array, one object per call:\n{\"callId\":\"...\",\"decision\":\"include|exclude\",\"exclude_reason\":null|\"...\",\"confidence\":\"high|medium|low\",\"summary\":\"one short sentence on what happened (<=25 words, no phone/email/addresses)\",\"booked_discovery\":true|false}\n";
const AM_RUBRIC = "# SCI Account Manager (AM) Call Scoring Rubric (v1)\n\nContext: Sunrise Capital Investors (SCI) raises capital for private real estate funds (mobile home parks, parking; Fund 5; Sunrise Income Fund = \"SIF\", an income-focused fund offered to EXISTING investors). Account Managers (Alex Zahn, Daniel Ackerman) call existing investors. Four call types:\n\n1. **checkup**: quarterly check-in / relationship call with an existing investor.\n2. **sif_pitch**: a call whose main purpose is getting the investor to invest in the Sunrise Income Fund (or add capital to it).\n3. **onboarding**: welcoming a new/just-funded investor; walking them through next steps, portal, paperwork, what to expect.\n4. **other**: admin/service only (K-1s, distributions, address/bank changes, document requests), voicemail/IVR, wrong person, call cut off before a real conversation, or too short to evaluate. NOT scored.\n\nFirst classify the call. If \"other\", set all scores to null and give only a one-line summary.\n\n## Scoring (0-5 per item; 0 absent, 1 token, 2 weak, 3 adequate, 4 strong, 5 excellent). Use \"N/A\" where noted. Evidence from transcript only.\n\n### All scored types\n- **bonding**: genuine rapport; investor comfortable and talking.\n- **upfront_contract**: purpose and time stated early, agenda agreed, what happens at the end.\n- **discovery**: questions that uncover the investor's current situation: goals, life events, income needs, liquidity, tax situation, new money coming, satisfaction. (Onboarding: questions about expectations and concerns.)\n- **service**: answered questions accurately, resolved issues, set clear expectations (distribution timing, K-1 timing, reporting). Accuracy matters: wrong facts = low.\n- **next_step**: clear agreed next step (date/time or specific action and owner), or clean close.\n- **talk_control**: investor talks a healthy share; AM leads with questions rather than monologue.\n\n### checkup only (N/A otherwise)\n- **retention**: noticed and handled dissatisfaction, redemption/liquidity worries, or confusion.\n- **opportunity**: identified a reinvestment/new-money opportunity (SIF, Fund 5, referral) and raised it appropriately \u2014 without forcing it when it's not there. If no opportunity exists and the AM correctly doesn't push, score 3.\n\n### sif_pitch only (N/A otherwise)\n- **need_fit**: established why SIF fits THIS investor (income need, goals) before/while presenting.\n- **budget**: amount, source of funds (cash, IRA, distributions, redemption), timing.\n- **decision**: spouse/advisor/CPA involvement, how and when they'll decide.\n- **commitment**: asked for the commitment or a concrete next step toward it; handled objections.\n\n### onboarding only (N/A otherwise)\n- **clarity**: explained what happens next (funding, portal, documents, first distribution) clearly and correctly.\n\n## Flags\n- **compliance_flag**: promises or strongly implies guaranteed returns, guaranteed/perpetual distributions stated as certain, \"no risk\", \"you can't lose money\", or states projections as fact. Projections clearly framed as projections are OK. Quote the line.\n- **pressure_flag**: pushes an investment after the investor clearly declines, or uses urgency/pressure inappropriate for an existing-investor relationship.\n\n## Output (JSON array, one object per call)\n{\"callId\":\"...\",\"amType\":\"checkup|sif_pitch|onboarding|other\",\"rep\":\"...\",\"date\":\"YYYY-MM-DD\",\"durationMin\":n,\n \"scores\":{\"bonding\":n,\"upfront_contract\":n,\"discovery\":n,\"service\":n,\"next_step\":n,\"talk_control\":n,\"retention\":n|\"N/A\",\"opportunity\":n|\"N/A\",\"need_fit\":n|\"N/A\",\"budget\":n|\"N/A\",\"decision\":n|\"N/A\",\"commitment\":n|\"N/A\",\"clarity\":n|\"N/A\"} (or null for \"other\"),\n \"outcome\":\"short phrase: what was agreed/what happened\",\n \"compliance_flag\":{\"flag\":bool,\"quote\":\"...\"},\"pressure_flag\":bool,\n \"strengths\":[\"1-2 items with short quotes\"],\"coaching\":[\"1-3 specific actionable points tied to moments in the call\"],\n \"best_moment\":{\"time\":\"mm:ss\",\"quote\":\"<=25 words\",\"why\":\"...\"},\n \"topics\":[{\"k\":\"<key>\",\"t\":\"mm:ss\",\"q\":\"<=20 word quote\"}]}\nTopic keys (tag only substantive discussion): w2_high_income, tax_depreciation, reps_status, retirement_ira, exchange_1031, accreditation, returns_projections, risk_safety, liquidity_lockup, fund_structure, track_record, spouse_advisor, investment_amount, timing_capital_event, other_investments, objection_trust, distributions, k1_tax_docs, referral.\nQuotes <=25 words. Never include phone numbers, emails, addresses, account or bank details. Investor first names OK.\n";
const TOPICS = ["w2_high_income", "tax_depreciation", "reps_status", "retirement_ira", "exchange_1031", "accreditation", "returns_projections", "risk_safety", "liquidity_lockup", "fund_structure", "track_record", "spouse_advisor", "investment_amount", "timing_capital_event", "other_investments", "objection_trust", "distributions", "k1_tax_docs", "referral"];
const SENSITIVE = /\b(dementia|alzheimer\w*|cancer|chemo\w*|surgery|hospital\w*|diagnosis|diagnosed with|stroke|illness|terminal|hospice|heart attack|disease|disabilit\w*|mental health|therapy|rehab|strangle\w*|abus\w*|assault\w*|divorc\w*|ex[- ]husband|ex[- ]wife|died|passed away|funeral|accident|pregnan\w*)\b/i;

const S = (window.__CSP = window.__CSP || { log: [] });
const log = (m) => { S.log.push(new Date().toISOString().slice(11, 19) + " " + m); S.last = m; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(url, opt = {}, tries = 4) {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { cache: "no-store", ...opt });
      if (r.ok) return await r.json();
      if (r.status === 401 || r.status === 403) throw new Error(`${url} ${r.status} (signed in?)`);
      if (a === tries - 1) throw new Error(`${url} ${r.status}`);
    } catch (e) { if (a === tries - 1 || /signed in/.test(e.message)) throw e; }
    await sleep(1500 * (a + 1));
  }
}
const post = (p, b) => j(HS + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
async function searchAll(obj, body) {
  let out = [], after;
  do { const r = await post(`/crm/v3/objects/${obj}/search`, { ...body, limit: 200, after }); out = out.concat(r.results || []); after = r.paging?.next?.after; } while (after);
  return out;
}
async function assoc(from, to, ids) {
  const m = {};
  for (let i = 0; i < ids.length; i += 100) {
    const r = await post(`/crm/v4/associations/${from}/${to}/batch/read`, { inputs: ids.slice(i, i + 100).map((id) => ({ id: String(id) })) });
    (r.results || []).forEach((x) => (m[x.from.id] = x.to.map((t) => String(t.toObjectId))));
  }
  return m;
}
async function batchRead(obj, ids, props) {
  const m = {};
  for (let i = 0; i < ids.length; i += 100) {
    const r = await post(`/crm/v3/objects/${obj}/batch/read`, { inputs: ids.slice(i, i + 100).map((id) => ({ id: String(id) })), properties: props });
    (r.results || []).forEach((x) => (m[x.id] = x.properties));
  }
  return m;
}
const ts = (s) => new Date(s).getTime();

/* ───────────── 1. prepare: find new calls and stage the list ───────────── */
export async function prepare({ since } = {}) {
  S.phase = "prepare"; S.error = null; S.log = [];
  const cur = await j(API + "/cached-call-scores");
  const have = new Set([...(cur.calls || []), ...(cur.am || [])].map((c) => c.id));
  if (!since) {
    const last = [...(cur.calls || []), ...(cur.am || [])].map((c) => c.date).sort().pop() || "2026-09-24";
    since = new Date(ts(last + "T00:00:00Z") - 2 * 864e5).toISOString();
  }
  log(`since ${since.slice(0, 10)} · ${have.size} calls already on the dashboard`);
  const owners = Object.keys(REPS);
  const calls = await searchAll("calls", { filterGroups: [{ filters: [
    { propertyName: "hs_timestamp", operator: "GTE", value: since },
    { propertyName: "hubspot_owner_id", operator: "IN", values: owners },
    { propertyName: "hs_call_duration", operator: "GT", value: "0" }] }],
    properties: ["hs_timestamp", "hs_call_duration", "hs_call_disposition", "hs_call_has_transcript", "hubspot_owner_id", "hs_call_direction"] });
  const mtgs = await searchAll("meetings", { filterGroups: [{ filters: [
    { propertyName: "hs_meeting_start_time", operator: "GTE", value: since },
    { propertyName: "hs_activity_type", operator: "IN", values: [...INTRO_TYPES, ...DISCO_TYPES] }] }],
    properties: ["hs_activity_type", "hs_meeting_outcome", "hubspot_owner_id", "hs_meeting_start_time"] });
  const held = mtgs.filter((m) => ["COMPLETED", "DISQUALIFIED"].includes(m.properties.hs_meeting_outcome) || (m.properties.hs_meeting_outcome === "SCHEDULED" && ts(m.properties.hs_meeting_start_time) < Date.now()));
  log(`${calls.length} calls, ${held.length} held Intro/Discovery meetings`);
  const cc = await assoc("calls", "contacts", calls.map((c) => c.id));
  const mc = await assoc("meetings", "contacts", held.map((m) => m.id));
  const P = (c) => c.properties, dur = (c) => +P(c).hs_call_duration / 1000;
  const connected = (c) => !!CONNECTED[P(c).hs_call_disposition] || (!P(c).hs_call_disposition && P(c).hs_call_has_transcript === "true" && dur(c) >= 60);
  const used = new Set(), list = [];
  const push = (c, type, extra = {}) => { used.add(c.id); if (!have.has(c.id) && P(c).hs_call_has_transcript === "true") list.push({ id: c.id, type, ownerId: P(c).hubspot_owner_id, rep: REPS[P(c).hubspot_owner_id].name, start: P(c).hs_timestamp, dur: Math.round(dur(c)), dir: P(c).hs_call_direction, ...extra }); };
  for (const m of held.sort((a, b) => (a.properties.hs_meeting_start_time < b.properties.hs_meeting_start_time ? -1 : 1))) {
    const p = m.properties, t = ts(p.hs_meeting_start_time), isIntro = INTRO_TYPES.includes(p.hs_activity_type), cs = mc[m.id] || [];
    const cand = calls.filter((c) => !used.has(c.id) && P(c).hubspot_owner_id === p.hubspot_owner_id && (cc[c.id] || []).some((x) => cs.includes(x))
      && ts(P(c).hs_timestamp) - t >= -2 * 36e5 && ts(P(c).hs_timestamp) - t <= 4 * 36e5 && (isIntro ? connected(c) : dur(c) >= 180))
      .sort((a, b) => dur(b) - dur(a));
    if (cand[0]) push(cand[0], isIntro ? "intro" : "disco", { meetingId: m.id, meetingOutcome: p.hs_meeting_outcome });
  }
  for (const c of calls) {
    if (used.has(c.id)) continue;
    const role = REPS[P(c).hubspot_owner_id].role;
    if (role === "setter" && P(c).hs_call_direction === "OUTBOUND" && CONNECTED[P(c).hs_call_disposition] && dur(c) >= 180) push(c, "introU");
    else if (role === "am" && connected(c)) push(c, "am");
  }
  const counts = list.reduce((o, x) => ((o[x.type] = (o[x.type] || 0) + 1), o), {});
  log(`new calls to pull: ${list.length} ${JSON.stringify(counts)}`);
  const { nonce } = await j(API + "/stage-nonce", { method: "POST" });
  await j(`${API}/stage-list?nonce=${nonce}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ since, calls: list }) });
  S.nonce = nonce; S.phase = "prepared"; S.counts = counts;
  return { nonce, total: list.length, counts };
}

/* ───────────── 2. score: classify + score staged transcripts, refresh outcomes, save ───────────── */
function fmtTranscript(item, t) {
  const who = (t.participants || []).map((p) => `${p.name} (${p.role || "?"})`).join(", ");
  const lines = (t.transcript || []).map((u) => { const s = Math.floor(u.t || 0); return `[${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}] ${u.speaker}: ${u.text}`; });
  return `CALL ${item.id} | rep: ${item.rep} | ${item.start.slice(0, 16)} UTC | ${(item.dur / 60).toFixed(1)} min | ${item.dir || ""} | participants: ${who}\n` + lines.join("\n");
}
function promptFor(item) {
  const topicLine = `Topic keys (tag only substantive discussion, first timestamp, <=20-word quote): ${TOPICS.join(", ")}.`;
  const salesSchema = `{"scores":{"bonding_rapport":n,"upfront_contract":n,"pain":n,"budget":n,"decision":n,"next_step_contract":n,"fulfillment":n|"N/A","post_sell":n|"N/A","talk_control":n,"no_premature_presentation":n,"sandler_techniques":n},"outcome":"...","compliance_flag":{"flag":bool,"quote":"..."},"disqualify_missed":bool,"strengths":["..."],"coaching":["..."],"best_moment":{"time":"mm:ss","quote":"...","why":"..."},"topics":[{"k":"...","t":"mm:ss","q":"..."}]}`;
  if (item.type === "am") return `${AM_RUBRIC}\n\nScore the ONE call below. Reply with ONE JSON object only (no array, no prose, no code fences), in the per-call output format above.`;
  const kind = item.type === "disco" ? "Discovery Call" : item.type === "intro" ? "Intro Call" : "Intro Call (unscheduled)";
  let p = `${SALES_RUBRIC}\n\n${topicLine}\n\nThis call is a ${kind}.`;
  if (item.type === "introU") p += `\n\nFIRST decide whether it is really an intro conversation, using these rules:\n${CLASSIFY}\nIf it should be EXCLUDED reply with ONLY {"include":false,"exclude_reason":"...","summary":"..."}. If INCLUDED reply with {"include":true, ...the scoring object below}.`;
  return p + `\n\nReply with ONE JSON object only (no prose, no code fences):\n${salesSchema}`;
}
async function claude(system, user) {
  const models = [CFG.model, ...CFG.fallbackModels];
  let lastErr;
  for (const model of models) {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(API + "/claude-api", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: CFG.maxTokens, system, messages: [{ role: "user", content: user }] }) });
        const d = await r.json();
        if (r.status === 404 || d?.error?.type === "not_found_error") { lastErr = new Error("model " + model + " unavailable"); break; }
        if (!r.ok) { lastErr = new Error(d?.error?.message || r.status); await sleep(3000 * (a + 1)); continue; }
        S.usage.in += d.usage?.input_tokens || 0; S.usage.out += d.usage?.output_tokens || 0; S.model = model;
        const text = (d.content || []).map((c) => c.text || "").join("");
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error("no JSON in reply");
        return JSON.parse(m[0]);
      } catch (e) { lastErr = e; await sleep(2000 * (a + 1)); }
    }
  }
  throw lastErr;
}
const clean = (s) => (typeof s === "string" ? (SENSITIVE.test(s) ? "[withheld — personal details]" : s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[phone]")) : s);
const num = (v) => (typeof v === "number" ? v : null);
function toRecord(item, r) {
  const date = item.start.slice(0, 10), min = Math.round(item.dur / 6) / 10;
  const bm = r.best_moment || {};
  const base = { id: item.id, rep: item.rep, date, min, outcome: clean(r.outcome || r.summary || ""),
    flag: !!r.compliance_flag?.flag, flagQuote: r.compliance_flag?.flag ? clean(r.compliance_flag.quote || "") : "",
    strengths: (r.strengths || []).map(clean), coaching: (r.coaching || []).map(clean),
    best: { t: bm.time || "", q: clean(bm.quote || ""), why: clean(bm.why || "") },
    tags: (r.topics || []).filter((t) => t && TOPICS.includes(t.k)).map((t) => ({ k: t.k, t: t.t || "", q: clean(t.q || "") })) };
  const sc = r.scores || {};
  if (item.type === "am") {
    const K = ["bonding", "upfront_contract", "discovery", "service", "next_step", "talk_control", "retention", "opportunity", "need_fit", "budget", "decision", "commitment", "clarity"];
    const amType = ["checkup", "sif_pitch", "onboarding", "other"].includes(r.amType) ? r.amType : "other";
    const s = Object.fromEntries(K.map((k) => [k, amType === "other" ? null : num(sc[k])]));
    const v = Object.values(s).filter((x) => x != null);
    return { ...base, type: "am", amType, dir: item.dir, s, overall: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length / 5) * 100) : null, pressure: !!r.pressure_flag, o: {} };
  }
  const K = ["bonding_rapport", "upfront_contract", "pain", "budget", "decision", "next_step_contract", "fulfillment", "post_sell", "talk_control", "no_premature_presentation", "sandler_techniques"];
  const s = Object.fromEntries(K.map((k) => [k, item.type !== "disco" && (k === "fulfillment" || k === "post_sell") ? null : num(sc[k])]));
  const v = Object.values(s).filter((x) => x != null);
  return { ...base, type: item.type, s, overall: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length / 5) * 100) : 0, dqMissed: !!r.disqualify_missed, o: {} };
}

async function refreshOutcomes(recs) {
  const ids = recs.map((r) => r.id);
  if (!ids.length) return;
  const calls = await batchRead("calls", ids, ["hs_timestamp"]);
  const cc = await assoc("calls", "contacts", ids);
  const contacts = [...new Set(Object.values(cc).flat())];
  const cm = await assoc("contacts", "meetings", contacts);
  const mt = await batchRead("meetings", [...new Set(Object.values(cm).flat())], ["hs_activity_type", "hs_meeting_outcome", "hs_meeting_start_time", "hs_createdate"]);
  const cd = await assoc("contacts", "deals", contacts);
  const dt = await batchRead("deals", [...new Set(Object.values(cd).flat())], ["pipeline", "dealstage", "amount", "createdate", "closedate"]);
  const pipes = await j(HS + "/crm/v3/pipelines/deals");
  const L = {}; pipes.results.forEach((p) => p.stages.forEach((s) => (L[s.id] = { p: p.id, s: s.label, o: s.displayOrder })));
  const rank = (d) => (/closed lost/i.test(L[d.dealstage]?.s || "") ? -1 : L[d.dealstage]?.o || 0);
  for (const r of recs) {
    const t = ts(calls[r.id]?.hs_timestamp || r.date);
    const cs = cc[r.id] || [];
    const ms = cs.flatMap((c) => cm[c] || []).map((m) => mt[m]).filter(Boolean).filter((m) => ts(m.hs_createdate) >= t - 15 * 6e4);
    const ds = cs.flatMap((c) => cd[c] || []).map((d) => dt[d]).filter(Boolean);
    if (r.type === "intro" || r.type === "introU") {
      const dm = ms.filter((m) => /^Discovery Call/.test(m.hs_activity_type || ""));
      const heldM = dm.some((m) => m.hs_meeting_outcome === "COMPLETED");
      r.o = { discoBooked: dm.length > 0, discoHeld: heldM, discoPending: !heldM && dm.some((m) => m.hs_meeting_outcome === "SCHEDULED" && ts(m.hs_meeting_start_time) > Date.now()) };
    } else if (r.type === "disco") {
      const im = ms.filter((m) => /^Investment Decision Call/.test(m.hs_activity_type || ""));
      const mine = ds.filter((d) => [PIPE.MSP, PIPE.F5, PIPE.SIF].includes(d.pipeline)).sort((a, b) => rank(b) - rank(a));
      const top = mine[0], stage = top ? L[top.dealstage]?.s || null : null;
      const won = mine.some((d) => /closed won/i.test(L[d.dealstage]?.s || "") && ts(d.closedate) >= t - 864e5);
      r.o = { idcBooked: im.length > 0, idcHeld: im.some((m) => m.hs_meeting_outcome === "COMPLETED"), committed: won || /InvestNext Committed|Red Zone|Investor Sent Money|Closed Won/i.test(stage || ""), won, stage };
    } else if (r.type === "am") {
      const sif = ds.filter((d) => d.pipeline === PIPE.SIF).sort((a, b) => rank(b) - rank(a));
      r.o = { sifNew: sif.some((d) => ts(d.createdate) >= t - 15 * 6e4), sifStage: sif[0] ? L[sif[0].dealstage]?.s || null : null };
    }
  }
}

export function score({ nonce = S.nonce, dryRun = false } = {}) {
  S.phase = "scoring"; S.error = null; S.done = false; S.usage = { in: 0, out: 0 }; S.failed = []; S.excluded = 0; S.result = null;
  (async () => {
    const bundle = await j(`${API}/stage-bundle?nonce=${nonce}`);
    const list = bundle.list?.calls || [];
    const tx = Object.fromEntries((bundle.transcripts || []).map((t) => [String(t.callId), t]));
    log(`bundle: ${list.length} listed, ${Object.keys(tx).length} transcripts`);
    const todo = list.filter((i) => tx[i.id]?.transcript?.length);
    const newRecs = []; let k = 0; S.total = todo.length; S.progress = 0;
    await Promise.all(Array.from({ length: CFG.concurrency }, async () => {
      while (k < todo.length) {
        const item = todo[k++];
        try {
          const r = await claude(promptFor(item), fmtTranscript(item, tx[item.id]));
          if (item.type === "introU" && r.include === false) S.excluded++;
          else newRecs.push(toRecord(item, r));
        } catch (e) { S.failed.push({ id: item.id, error: String(e.message || e) }); }
        S.progress++;
      }
    }));
    log(`scored ${newRecs.length}, excluded ${S.excluded}, failed ${S.failed.length}`);
    const cur = await j(API + "/cached-call-scores");
    const calls = (cur.calls || []).concat(newRecs.filter((r) => r.type !== "am"));
    const am = (cur.am || []).concat(newRecs.filter((r) => r.type === "am"));
    const cutoff = new Date(Date.now() - CFG.outcomesLookbackDays * 864e5).toISOString().slice(0, 10);
    const recent = calls.concat(am).filter((r) => r.date >= cutoff && !(r.type === "am" && r.amType === "other"));
    log(`refreshing outcomes on ${recent.length} calls since ${cutoff}`);
    await refreshOutcomes(recent);
    const today = new Date().toISOString().slice(0, 10);
    const out = { ...cur, generated: today, outcomesAsOf: today, calls: calls.sort((a, b) => (a.date + a.id < b.date + b.id ? -1 : 1)), am: am.sort((a, b) => (a.date + a.id < b.date + b.id ? -1 : 1)), lastRun: { at: new Date().toISOString(), added: newRecs.length, excluded: S.excluded, failed: S.failed.length, model: S.model, usage: S.usage } };
    const added = newRecs.reduce((o, r) => { const key = r.type === "am" ? `AM ${r.amType} · ${r.rep}` : `${r.type} · ${r.rep}`; o[key] = (o[key] || 0) + 1; return o; }, {});
    S.result = { dryRun, added, newFlags: newRecs.filter((r) => r.flag).map((r) => ({ id: r.id, rep: r.rep, quote: r.flagQuote })), excluded: S.excluded, failed: S.failed, usage: S.usage, model: S.model, totalCalls: out.calls.length, totalAm: out.am.length, latestDate: [...out.calls, ...out.am].map((c) => c.date).sort().pop() };
    if (!dryRun) {
      const r = await fetch(API + "/cached-call-scores", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(out) });
      if (!r.ok) throw new Error("save failed " + r.status);
      await fetch(`${API}/stage-clear?nonce=${nonce}`, { method: "POST" });
      log("saved to dashboard and cleared staging");
    } else { S.preview = out; log("dry run: nothing saved"); }
    S.phase = "done"; S.done = true;
  })().catch((e) => { S.error = String(e.message || e); S.phase = "error"; S.done = true; log("ERROR " + S.error); });
  return "started";
}

/* Code the scheduled run injects into a HubSpot call-review tab. Replace NONCE. */
export const HUBSPOT_SNIPPET = `(async()=>{const W='https://sunrise-hubspot-proxy.billing-d58.workers.dev',N='NONCE';const S=window.__CSX={done:false,ok:0,fail:[],parts:0};try{
const L=await (await fetch(W+'/stage-list?nonce='+N,{cache:'no-store'})).json();const ids=(L&&L.calls||[]).map(c=>c.id);S.total=ids.length;
const csrf=(document.cookie.match(/hubspotapi-csrf=([^;]+)/)||[])[1];const sl=ms=>new Promise(r=>setTimeout(r,ms));
const red=s=>(s||'').replace(/[\\w.+-]+@[\\w-]+\\.[\\w.]+/g,'[email]').replace(/(\\+?1[\\s.-]?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}/g,'[phone]');
let buf=[];const flush=async()=>{if(!buf.length)return;const r=await fetch(W+'/stage-transcripts?nonce='+N+'&part='+S.parts,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(buf)});if(!r.ok)throw new Error('upload '+r.status);S.parts++;buf=[]};
for(const id of ids){let d;for(let a=0;a<3;a++){try{const r=await fetch('/api/chirp-frontend-app/v1/gateway/com.hubspot.recording.review.be.rpc.InitializationRpc/getRecordingReviewResponse?portalId=23126809',{method:'POST',credentials:'include',headers:{'content-type':'application/json','X-HubSpot-CSRF-hubspotapi':csrf},body:JSON.stringify({crmObjectId:+id,objectTypeId:'0-48'})});if(r.ok){d=await r.json();break}}catch(e){}await sl(2000)}
const res=d&&d.data&&d.data.result;if(!res||!res.transcript||!res.transcript.utterances){S.fail.push(id);continue}
const parts=(res.callMetadata&&res.callMetadata.callParticipantsMetadata||[]).map(p=>({speakerTrackId:p.mappedSpeakerTrackId,name:p.participantName,role:p.participantRole||p.mappedCategory||p.participantType}));
const nm=t=>{const p=parts.find(x=>x.speakerTrackId===t);return p?p.name:'Speaker '+t};
buf.push({callId:String(id),participants:parts.map(p=>({name:p.name,role:p.role})),transcript:res.transcript.utterances.map(u=>({t:u.startTimeSeconds,speaker:nm(u.speakerTrackId),text:red(u.utterance)}))});S.ok++;
if(buf.length>=20)await flush();await sl(600)}await flush();}catch(e){S.error=String(e.message||e)}S.done=true})();'started'`;