// Arrivo — reys izləyici + WhatsApp bildirişləri (Cloudflare Worker, Cron ilə işləyir)
//
// Settings → Variables and Secrets:
//   SUPABASE_URL          (Text)    https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  (Secret)  Supabase → Project Settings → API → service_role
//   RAPIDAPI_KEY          (Secret)  AeroDataBox açarı (yoxdursa reys izləmə işləmir)
//   WA_TOKEN              (Secret)  Meta → WhatsApp → API Setup → access token (yoxdursa WhatsApp göndərilmir)
//   WA_PHONE_ID           (Text)    Meta → WhatsApp → API Setup → Phone number ID
//   WA_LANG               (Text)    şablonların dili, default "az"
//   WA_TEST_TO            (Text)    sınaq üçün: bütün mesajlar yalnız bu nömrəyə getsin (994501234567)
//   RUN_KEY               (Secret)  istənilən uzun söz; əl ilə yoxlamaq üçün
//   AIRPORT               (Text)    GYD (default)
//   MAX_CALLS             (Text)    bir dövrdə ən çox API sorğusu, default 15
//   NEAR_MIN              (Text)    yaxın reysləri neçə dəqiqədən bir yoxlasın, default 15
//   FAR_MIN               (Text)    uzaq reysləri neçə dəqiqədən bir yoxlasın, default 180
// Triggers → Cron Triggers:  * * * * *   (hər dəqiqə; reyslər yenə də 15 dəqiqədən bir yoxlanır)

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAll(env).then((r) => console.log(JSON.stringify(r))));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!env.RUN_KEY || url.searchParams.get("key") !== env.RUN_KEY) {
      return new Response("Arrivo worker işləyir.", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return Response.json(await runAll(env));
  },
};

async function runAll(env) {
  const out = {};
  if (env.RAPIDAPI_KEY) out.flights = await run(env).catch((e) => ({ error: String(e && e.message) }));
  else out.flights = "RAPIDAPI_KEY yoxdur, reys izləmə söndürülüb";
  if (env.WA_TOKEN && env.WA_PHONE_ID) out.whatsapp = await sendWhatsApp(env).catch((e) => ({ error: String(e && e.message) }));
  else out.whatsapp = "WA_TOKEN / WA_PHONE_ID yoxdur, WhatsApp söndürülüb";
  return out;
}

function supa(env) {
  return (path, opt = {}) =>
    fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path, {
      ...opt,
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: "Bearer " + env.SUPABASE_SERVICE_KEY,
        "Content-Type": "application/json",
        Prefer: opt.prefer || "return=minimal",
      },
    });
}

// Bazadakı növbədən WhatsApp şablon mesajlarını göndərir
async function sendWhatsApp(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY yoxdur");
  const sb = supa(env);
  const old = new Date(Date.now() - 2 * 3600e3).toISOString();
  // 2 saatdan köhnə göndərilməmiş mesajlar artıq aktual deyil
  await sb(`notifications?channel=eq.whatsapp&status=eq.pending&created_at=lt.${old}`, { method: "PATCH", body: JSON.stringify({ status: "skipped" }) });
  const r = await sb("notifications?select=id,to_phone,template,params,attempts&channel=eq.whatsapp&status=eq.pending&order=id&limit=40");
  if (!r.ok) throw new Error("Supabase " + r.status);
  const list = await r.json();
  let sent = 0, failed = 0;
  const log = [];
  for (const n of list) {
    // Eyni mesajı iki dəfə göndərməmək üçün əvvəlcə "sending" edirik
    const c = await sb(`notifications?id=eq.${n.id}&status=eq.pending`, {
      method: "PATCH", prefer: "return=representation", body: JSON.stringify({ status: "sending" }),
    });
    if (!c.ok || !(await c.json()).length) continue;
    const to = env.WA_TEST_TO ? String(env.WA_TEST_TO).replace(/\D/g, "") : n.to_phone;
    const res = await fetch(`https://graph.facebook.com/v21.0/${env.WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: "Bearer " + env.WA_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: n.template,
          language: { code: env.WA_LANG || "az" },
          components: [{ type: "body", parameters: (n.params || []).map((t) => ({ type: "text", text: String(t).slice(0, 900) })) }],
        },
      }),
    });
    if (res.ok) {
      sent++;
      await sb(`notifications?id=eq.${n.id}`, { method: "PATCH", body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }) });
    } else {
      failed++;
      const err = (await res.text()).slice(0, 400);
      const tries = (n.attempts || 0) + 1;
      log.push(`${n.template} → ${to}: ${res.status}`);
      await sb(`notifications?id=eq.${n.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: tries >= 3 || res.status < 500 ? "failed" : "pending", attempts: tries, error: err }),
      });
    }
  }
  return { queued: list.length, sent, failed, log };
}

async function run(env) {
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "RAPIDAPI_KEY"].filter((k) => !env[k]);
  if (need.length) throw new Error("Dəyişənlər yoxdur: " + need.join(", "));
  const sb = supa(env);

  const now = Date.now();
  const baku = new Date(now + 4 * 3600e3);
  const today = baku.toISOString().slice(0, 10);
  const tomorrow = new Date(baku.getTime() + 864e5).toISOString().slice(0, 10);

  const res = await sb(
    `transfers?select=id,type,date,flight,sched,est,flight_checked_at` +
      `&date=in.(${today},${tomorrow})&status=not.in.(done,cancelled,noshow)&flight=neq.`
  );
  if (!res.ok) throw new Error("Supabase " + res.status);
  const rows = await res.json();

  // Eyni reys + tarix + növ üçün API-yə bir dəfə müraciət
  const groups = new Map();
  for (const t of rows) {
    const num = String(t.flight || "").replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(num)) continue;
    const key = num + "|" + t.date + "|" + t.type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const ap = (env.AIRPORT || "GYD").toUpperCase();
  const max = +env.MAX_CALLS || 15, near = +env.NEAR_MIN || 15, far = +env.FAR_MIN || 180;
  let calls = 0, updated = 0;
  const log = [];

  // Ən yaxın reyslər birinci
  const order = [...groups.entries()].sort((a, b) => when(a[1][0]) - when(b[1][0]));
  for (const [key, list] of order) {
    const t = list[0];
    const mins = (when(t) - now) / 6e4;
    if (mins < -180) continue; // çoxdan keçib
    const age = t.flight_checked_at ? (now - Date.parse(t.flight_checked_at)) / 6e4 : Infinity;
    if (age < (mins <= 360 ? near : far)) continue;
    if (calls >= max) break;
    calls++;

    const [num, date, type] = key.split("|");
    const patch = { flight_checked_at: new Date(now).toISOString() };
    const r = await fetch(
      `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(num)}/${date}` +
        `?withAircraftImage=false&withLocation=false&dateLocalRole=Both`,
      { headers: { "X-RapidAPI-Key": env.RAPIDAPI_KEY, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" } }
    );
    if (r.status === 429) { log.push(num + ": limit"); break; }
    if (r.ok && r.status !== 204) {
      const legs = await r.json();
      const leg = (Array.isArray(legs) ? legs : []).find((l) =>
        type === "arr" ? l.arrival?.airport?.iata === ap : l.departure?.airport?.iata === ap
      );
      if (leg) {
        const side = type === "arr" ? leg.arrival : leg.departure;
        const hhmm = (x) => (x && x.local ? String(x.local).slice(11, 16) : "");
        const est = hhmm(side.revisedTime) || hhmm(side.predictedTime) || hhmm(side.runwayTime);
        patch.flight_status = String(leg.status || "");
        patch.flight_cancelled = /^Cancel/i.test(patch.flight_status);
        if (type === "arr" && /^\d{2}:\d{2}$/.test(est)) patch.est = est;
        log.push(`${num}: ${patch.flight_status}${patch.est ? " " + patch.est : ""}`);
      } else log.push(num + ": tapılmadı");
    } else log.push(num + ": " + r.status);

    const ids = list.map((x) => x.id).join(",");
    const u = await sb(`transfers?id=in.(${ids})`, { method: "PATCH", body: JSON.stringify(patch) });
    if (u.ok) updated += list.length;
  }
  return { flights: groups.size, apiCalls: calls, transfersUpdated: updated, log };
}

function when(t) {
  return Date.parse(`${t.date}T${t.est || t.sched}:00+04:00`) || 0;
}
