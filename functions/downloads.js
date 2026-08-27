// The download numbers as plain data, for something else to watch.
//
// /stats is the page a person reads. This is the same figures without the
// page around them, so a program can ask "has anything happened since I last
// looked?" and say so. Asked for: "some kind of system in place that alerts me
// when someone has downloaded from the website, and a counter to how many
// downloads, not just for AWBN but for anything."
//
// No secret guards it. It is a count of public downloads, and hiding it behind
// a token would mean putting that token in whatever does the watching.

export async function onRequestGet({ env }) {
  const kv = env.KADAKEN_STATS;
  const empty = { ok: false, error: "counter not connected" };
  if (!kv) return json(empty, 503);

  const read = async (k) => parseInt((await kv.get(k)) || "0", 10);
  const files = {};
  for (const entry of (await kv.list({ prefix: "file:" })).keys) {
    files[entry.name.slice(5)] = await read(entry.name);
  }
  const days = {};
  for (const entry of (await kv.list({ prefix: "day:" })).keys) {
    days[entry.name.slice(4)] = await read(entry.name);
  }
  const countries = {};
  for (const entry of (await kv.list({ prefix: "country:" })).keys) {
    countries[entry.name.slice(8)] = await read(entry.name);
  }

  const newPeople = {};
  for (const entry of (await kv.list({ prefix: "newpeople:" })).keys) {
    newPeople[entry.name.slice(10)] = await read(entry.name);
  }

  return json({
    ok: true,
    total: await read("total"),
    // How many DIFFERENT people, not how many downloads. Three of you testing
    // a link and three strangers finding it produce the same total; only this
    // tells them apart.
    people: await read("people"),
    newPeopleByDay: newPeople,
    last: await kv.get("last"),
    files,
    days,
    countries,
    recent: JSON.parse((await kv.get("recent")) || "[]"),
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Always fresh: the whole point is noticing a change.
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
