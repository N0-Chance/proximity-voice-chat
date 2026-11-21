// Run with: node test/propagation.mjs
// The sound propagation maths (scripts/voice-propagation.js) on its own: no Foundry, no browser.
const script = process.argv[2] ?? new URL("../scripts/voice-propagation.js", import.meta.url).href;
const P = await import(script.startsWith("file:") || script.startsWith("/") === false ? script : "file://" + script);

let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log((ok ? "ok  " : "FAIL") + " " + label + (detail !== "" ? "  [" + detail + "]" : "")); };
const near = (label, got, want, tolerance = 0.01) => check(label, Math.abs(got - want) <= tolerance, got + " (want " + want + ")");

const SENSE = { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 };
const wall = (ax, ay, bx, by, extra = {}) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, sense: SENSE.NORMAL, door: 0, ds: 0, dir: 0, ...extra });
const M = P.DEFAULT_MUFFLE;
const eased = (d, r) => d >= r ? 0 : (Math.cos(Math.PI * d / r) + 1) / 2;

// --- which muffle setting a wall falls under
check("a Normal wall is 'normal'", P.wall_kind(wall(0, 0, 1, 0)) === "normal");
check("a Limited wall is 'limited'", P.wall_kind(wall(0, 0, 1, 0, { sense: SENSE.LIMITED })) === "limited");
check("Proximity and Distance walls have their own kinds", P.wall_kind(wall(0, 0, 1, 0, { sense: SENSE.PROXIMITY })) === "proximity" && P.wall_kind(wall(0, 0, 1, 0, { sense: SENSE.DISTANCE })) === "distance");
check("a wall with no sound restriction passes sound", P.wall_kind(wall(0, 0, 1, 0, { sense: SENSE.NONE })) === null);
check("a closed door is 'door'", P.wall_kind(wall(0, 0, 1, 0, { door: 1, ds: 0 })) === "door");
check("a locked door is 'locked'", P.wall_kind(wall(0, 0, 1, 0, { door: 1, ds: 2 })) === "locked");
check("a secret door is 'secret', locked or not", P.wall_kind(wall(0, 0, 1, 0, { door: 2, ds: 0 })) === "secret" && P.wall_kind(wall(0, 0, 1, 0, { door: 2, ds: 2 })) === "secret");
check("an open door passes sound", P.wall_kind(wall(0, 0, 1, 0, { door: 1, ds: 1 })) === null);
check("a door that doesn't restrict sound passes it", P.wall_kind(wall(0, 0, 1, 0, { door: 1, ds: 0, sense: SENSE.NONE })) === null);

// --- muffle amount -> sound
check("0% muffle is no filter", P.muffle_cutoff(0) === P.OPEN_CUTOFF && P.muffle_gain(0) === 1);
{ const c = P.muffle_cutoff(M.door); check("a closed door (default) keeps speech intelligible: cutoff between 2 and 3 kHz", c >= 2000 && c <= 3000, Math.round(c) + " Hz"); }
{ const c = P.muffle_cutoff(M.limited); check("a Limited wall (default) is clearly muffled but intelligible: 2.5-5 kHz", c >= 2500 && c <= 5000, Math.round(c) + " Hz"); }
{ const c = P.muffle_cutoff(M.normal); check("a Normal wall (default) is heavily muffled: under 1 kHz, above Foundry's 100 Hz floor", c < 1000 && c > 500, Math.round(c) + " Hz"); }
check("cutoffs fall steadily as muffle rises", [0.1, 0.3, 0.5, 0.7, 0.9, 1].every((m, i, a) => i === 0 || P.muffle_cutoff(m) < P.muffle_cutoff(a[i - 1])));
check("muffling changes tone more than loudness: a closed door costs under 3 dB", 20 * Math.log10(P.muffle_gain(M.door)) > -3, (20 * Math.log10(P.muffle_gain(M.door))).toFixed(1) + " dB");
check("a Normal wall costs under 6 dB", 20 * Math.log10(P.muffle_gain(M.normal)) > -6, (20 * Math.log10(P.muffle_gain(M.normal))).toFixed(1) + " dB");
check("loudness drops steeply only near 100%", P.muffle_gain(0.95) < 0.25 && P.muffle_gain(0.99) < 0.05 && P.muffle_gain(1) === 0);
check("the old path can only turn muffle into volume", P.muffle_gain_legacy(0) === 1 && P.muffle_gain_legacy(0.5) === 0.5 && P.muffle_gain_legacy(1) === 0);
check("the old path loses more volume to a wall than the new one, having no filter", P.muffle_gain_legacy(0.5) < P.muffle_gain(0.5));

// --- compounding
near("two closed doors compound: 50% then 50% of the rest", P.combine_muffle([0.5, 0.5]), 0.75);
near("no crossings, no muffle", P.combine_muffle([]), 0);
check("one 100% crossing blocks whatever else is crossed", P.combine_muffle([0.2, 1, 0.1]) === 1);
check("compounding never goes past 100%", P.combine_muffle([0.9, 0.9, 0.9]) < 1);

// --- distance
near("falloff matches Foundry's cosine easing", P.distance_falloff(500, 0, 1200), eased(500, 1200));
check("full volume on the same spot, silent past the radius", P.distance_falloff(0, 0, 1200) === 1 && P.distance_falloff(1201, 0, 1200) === 0);
check("height counts too", P.distance_falloff(300, 300, 1200) < P.distance_falloff(300, 0, 1200));

// --- the straight line through walls
const A = { x: 0, y: 0 }, B = { x: 600, y: 0 };
const path = (walls, extra = {}) => ({ origin: A, destination: B, radius: 1200, walls, muffle: M, ...extra });
{
  const h = P.direct_sound(path([]));
  check("nothing in the way: heard in the open, unmuffled", h.via === "open" && h.muffle === 0);
  near("...at the distance volume", h.volume, eased(600, 1200));
}
{
  const h = P.direct_sound(path([wall(300, -200, 300, 200)]));
  check("one Normal wall: heard through it", h.via === "through" && h.walls.normal === 1, JSON.stringify(h.walls));
  near("...muffled by the Normal amount", h.muffle, M.normal);
  near("...distance volume unchanged; the muffle is applied to tone and gain separately", h.volume, eased(600, 1200));
}
{
  const h = P.direct_sound(path([wall(200, -200, 200, 200, { door: 1 }), wall(400, -200, 400, 200, { sense: SENSE.LIMITED })]));
  check("a closed door and a Limited wall are both counted", h.walls.door === 1 && h.walls.limited === 1, JSON.stringify(h.walls));
  near("...and compound", h.muffle, 1 - (1 - M.door) * (1 - M.limited));
}
check("a wall beside the line isn't crossed", P.direct_sound(path([wall(300, 50, 300, 200)])).via === "open");
check("a wall beyond the listener isn't crossed", P.direct_sound(path([wall(700, -200, 700, 200)])).via === "open");
check("an open door isn't crossed", P.direct_sound(path([wall(300, -200, 300, 200, { door: 1, ds: 1 })])).via === "open");
check("a wall with no sound restriction isn't crossed", P.direct_sound(path([wall(300, -200, 300, 200, { sense: SENSE.NONE })])).via === "open");
check("a wall type set to 0% is as good as absent", P.direct_sound(path([wall(300, -200, 300, 200)], { muffle: { ...M, normal: 0 } })).via === "open");
{
  const h = P.direct_sound(path([wall(300, -200, 300, 200)], { muffle: { ...M, normal: 1 } }));
  check("a wall type set to 100% blocks completely", h.via === "blocked" && h.volume === 0 && h.muffle === 1, JSON.stringify(h));
}
{
  // two walls meeting exactly where the line passes: one crossing, not two
  const h = P.direct_sound(path([wall(300, -200, 300, 0), wall(300, 0, 300, 200)]));
  check("walls meeting on the line count once", h.walls.normal === 1, JSON.stringify(h.walls));
  near("...muffled once", h.muffle, M.normal);
}
check("out of range is out of range, walls or not", P.direct_sound(path([], { radius: 500 })).via === "range" && P.direct_sound(path([], { radius: 500 })).volume === 0);
// Foundry's own rules for which walls count from where the sound starts
check("a one-way wall blocks from one side only",
  (P.direct_sound(path([wall(300, -200, 300, 200, { dir: 1 })])).via === "open") !== (P.direct_sound(path([wall(300, -200, 300, 200, { dir: 2 })])).via === "open"));
check("a one-way wall that blocks A to B lets B to A through",
  P.direct_sound({ ...path([wall(300, -200, 300, 200, { dir: 2 })]), origin: B, destination: A }).via !== P.direct_sound(path([wall(300, -200, 300, 200, { dir: 2 })])).via);
check("a Proximity wall lets a speaker close to it through", P.direct_sound(path([wall(300, -200, 300, 200, { sense: SENSE.PROXIMITY, threshold: 400 })])).via === "open");
check("...and muffles one further away", P.direct_sound(path([wall(300, -200, 300, 200, { sense: SENSE.PROXIMITY, threshold: 200 })])).walls?.proximity === 1);
check("a Distance wall lets a speaker far from it through", P.direct_sound(path([wall(300, -200, 300, 200, { sense: SENSE.DISTANCE, threshold: 200 })])).via === "open");
check("...and muffles one close to it", P.direct_sound(path([wall(300, -200, 300, 200, { sense: SENSE.DISTANCE, threshold: 400 })])).walls?.distance === 1);

// --- routes around walls
{
  // a wall between them that ends 200px above the line: round its end
  const graph = P.build_graph([wall(300, -200, 300, 400)]);
  check("a loose wall has a node off each end", graph.nodes.length === 2, JSON.stringify(graph.nodes));
  const route = P.find_route(graph, A, B, 1200);
  const expected = 2 * Math.hypot(300, 210);
  check("the route goes round the nearer end", !!route && route.points.length === 3 && route.points[1].y < -200, JSON.stringify(route?.points));
  near("...its length is the two legs", route.length, expected, 1);
  check("...with one bend", route.bends === 1);
  check("no route when the voice doesn't carry that far", P.find_route(graph, A, B, expected - 20) === null);
}
{
  // an L-shaped corner: speaker in the corridor going down, listener in the corridor going right
  const corner = [wall(100, 100, 100, 600), wall(100, 100, 600, 100)];
  const graph = P.build_graph(corner);
  check("a corner has one node on its outside, none inside; loose ends have theirs", graph.nodes.length === 3 && graph.nodes.some(n => n.x < 100 && n.y < 100), JSON.stringify(graph.nodes));
  const route = P.find_route(graph, { x: 50, y: 400 }, { x: 400, y: 50 }, 1200);
  check("round the corner in one bend", !!route && route.bends === 1 && route.points[1].x < 100 && route.points[1].y < 100, JSON.stringify(route?.points));
  check("walls drawn end to end in a straight line make no node where they join", P.build_graph([wall(0, 0, 100, 0), wall(100, 0, 200, 0)]).nodes.length === 2);
  check("a T-junction makes no node at the junction", P.build_graph([wall(0, 0, 100, 0), wall(100, 0, 200, 0), wall(100, 0, 100, 100)]).nodes.length === 3);
}
{
  // a closed room: no way round
  const room = [wall(200, -200, 400, -200), wall(400, -200, 400, 200), wall(400, 200, 200, 200), wall(200, 200, 200, -200)];
  const graph = P.build_graph(room);
  check("no route into a closed room", P.find_route(graph, A, { x: 300, y: 0 }, 5000) === null);
  check("a room's corners only have nodes on the outside", graph.nodes.length === 4 && graph.nodes.every(n => n.x < 200 || n.x > 400), JSON.stringify(graph.nodes));
  const route = P.find_route(graph, A, B, 5000);
  check("round a pillar (or a tree): two bends", !!route && route.bends === 2, JSON.stringify(route?.points));
  check("visibility between corners is remembered for the next search", graph.visible.size > 0);
}
{
  // a zig-zag: the route needs two corners
  const graph = P.build_graph([wall(200, -1000, 200, 100), wall(400, -100, 400, 1000)]);
  const route = P.find_route(graph, A, B, 2000);
  check("a zig-zag takes the gap between the walls", !!route && route.points.length === 4, JSON.stringify(route?.points));
  near("...and is the shortest way through", route.length, Math.hypot(200, 110) + Math.hypot(200, 220) + Math.hypot(200, 110), 2);
  check("a search that runs out of budget gives up instead of stalling", P.find_route(graph, A, B, 2000, { max_tests: 1 }) === null);
}

// --- the clearest of the two
{
  // a short Normal wall: round its end is barely longer than straight through
  const walls = [wall(300, -50, 300, 400)];
  const h = P.propagate(path(walls, { graph: P.build_graph(walls) }));
  check("a short way round beats straight through a wall", h.via === "around" && h.bends === 1, JSON.stringify(h));
  near("...as loud as the route's length allows", h.volume, eased(2 * Math.hypot(300, 60), 1200), 0.01);
  near("...a little muffled by the bend", h.muffle, P.BEND_MUFFLE);
  check("...and arrives from the corner, not from the speaker", h.from.x === 300 && h.from.y < -50, JSON.stringify(h.from));
}
{
  // a long wall: the way round is nearly out of range, so through the wall is clearer
  const walls = [wall(300, -500, 300, 500)];
  const h = P.propagate(path(walls, { graph: P.build_graph(walls) }));
  check("a long way round loses to straight through", h.via === "through", JSON.stringify(h));
  check("...which arrives from the speaker", h.from === A);
}
{
  // the same long wall set to block completely: now the long way round is all there is
  const walls = [wall(300, -500, 300, 500)];
  const h = P.propagate(path(walls, { graph: P.build_graph(walls), muffle: { ...M, normal: 1 } }));
  check("a 100% wall is routed round", h.via === "around" && h.volume > 0, JSON.stringify(h));
  const sealed = [wall(200, -200, 400, -200), wall(400, -200, 400, 200), wall(400, 200, 200, 200), wall(200, 200, 200, -200)];
  const inside = P.propagate({ origin: A, destination: { x: 300, y: 0 }, radius: 1200, walls: sealed, graph: P.build_graph(sealed), muffle: { ...M, normal: 1 } });
  check("with no way round either, it's silent", inside.via === "blocked" && inside.volume === 0, JSON.stringify(inside));
  check("without a graph only the straight line is tried", P.propagate(path(walls)).via === "through");
}
{
  // whisper and yell scale the radius, and so the longest route
  const walls = [wall(300, -200, 300, 400)];
  const graph = P.build_graph(walls);
  const blocking = { ...M, normal: 1 };
  check("a whisper's small radius doesn't reach round the wall", P.propagate(path(walls, { graph, muffle: blocking, radius: 700 })).volume === 0);
  check("a yell's large radius does", P.propagate(path(walls, { graph, muffle: blocking, radius: 2400 })).volume > 0);
}

// --- left and right
near("a voice to the right pans right, by the strength", P.pan_for({ x: 0, y: 0 }, { x: 500, y: 0 }, 0.6, 50), 0.6);
near("a voice to the left pans left", P.pan_for({ x: 0, y: 0 }, { x: -500, y: 0 }, 1, 50), -1);
near("a voice straight ahead (up the screen) is centred", P.pan_for({ x: 0, y: 0 }, { x: 0, y: -500 }, 1, 50), 0);
near("a voice diagonally off is partly panned", P.pan_for({ x: 0, y: 0 }, { x: 300, y: 300 }, 1, 50), Math.SQRT1_2);
check("a voice right on top of you eases to the centre", Math.abs(P.pan_for({ x: 0, y: 0 }, { x: 5, y: 0 }, 1, 50)) <= 0.1);
check("strength 0 is always centred", P.pan_for({ x: 0, y: 0 }, { x: 500, y: 0 }, 0, 50) === 0);

// --- in words, for Voice Diagnostics
check("in the open", P.describe_hearing({ volume: 1, muffle: 0, via: "open" }) === "in the open");
check("around a corner, in tiles", P.describe_hearing({ volume: 0.5, muffle: 0.15, via: "around", length: 1400, bends: 2 }, { grid: 100 }) === "around corners (route 14 tiles, 2 bends)", P.describe_hearing({ volume: 0.5, muffle: 0.15, via: "around", length: 1400, bends: 2 }, { grid: 100 }));
check("through a door, with the muffle", P.describe_hearing({ volume: 0.5, muffle: 0.5, via: "through", walls: { door: 1 } }) === "through 1 closed door (muffled 50%)");
{
  const h = P.direct_sound(path([wall(200, -200, 200, 200), wall(300, -200, 300, 200), wall(400, -200, 400, 200, { door: 2 })]));
  const full = P.describe_hearing(h), redacted = P.describe_hearing(h, { redact: true });
  check("several kinds are listed", full.startsWith("through 2 walls and 1 secret door (muffled "), full);
  check("a player's own view doesn't name secret doors", !redacted.includes("secret") && redacted.startsWith("through 3 walls"), redacted);
}
check("blocked says by what", P.describe_hearing({ volume: 0, muffle: 1, via: "blocked", walls: { normal: 1 } }) === "blocked by 1 wall");
check("nothing to say when out of range", P.describe_hearing({ volume: 0, muffle: 0, via: "range" }) === "");

console.log(fails ? fails + " FAILURES" : "ALL PASSED");
process.exit(fails ? 1 : 0);
