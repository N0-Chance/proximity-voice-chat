/**
 * How a voice gets from a speaker's token to a listener's: straight through walls, muffled by each one it crosses,
 * or around them through open space, fading with the length of the route. The listener hears the clearer of the two.
 *
 * Everything here is plain maths on plain data (points, and walls as {a, b, sense, door, ds, dir, threshold}), with no
 * Foundry or browser APIs, so the Node tests can run it directly. proximity-voice-chat.js turns Foundry's wall edges
 * into that data and caches the results.
 */

/** Kept in step with module.json by tools/release.sh, checked against SCRIPT_VERSION to catch stale caches */
export const PROPAGATION_SCRIPT_VERSION = "2.2.1";

/**
 * The kinds of wall a GM sets a muffle amount for: the four sound restrictions, and doors by state.
 * A wall with no sound restriction, and an open door, are no kind at all: sound passes them untouched.
 */
export const WALL_KINDS = ["limited", "normal", "proximity", "distance", "door", "locked", "secret"];

/**
 * Muffle amounts per crossing, from 0 (no effect) to 1 (blocks completely). Speech stays intelligible but clearly
 * muffled through one Limited wall or a closed door, and is heavily muffled through a Normal wall.
 * A secret door defaults to the same as a Normal wall, so it doesn't give itself away by ear.
 */
export const DEFAULT_MUFFLE = { limited: 0.4, normal: 0.75, proximity: 0.75, distance: 0.75, door: 0.5, locked: 0.6, secret: 0.75 };

/** The extra muffling for each bend in a route around walls */
export const BEND_MUFFLE = 0.08;

/**
 * Muffled this much, a voice is a faint rumble nobody could follow, so it counts as blocked: silent, and with no
 * speaking cue to give the speaker away. Three Normal walls at the default 75% get here; two don't.
 */
export const BLOCKED_AT = 0.97;

/** A filter cutoff this high is no filter at all */
export const OPEN_CUTOFF = 20000;
/** The cutoff just short of fully blocked: a low rumble */
const CLOSED_CUTOFF = 300;
/** A change of direction smaller than this isn't a bend, in radians (15 degrees) */
const BEND_ANGLE = Math.PI / 12;

// the values of Foundry's CONST.EDGE_SENSE_TYPES, WALL_DOOR_TYPES, WALL_DOOR_STATES and EDGE_DIRECTIONS
const SENSE = { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 };
const DOOR = { NONE: 0, DOOR: 1, SECRET: 2 };
const DOOR_STATE = { CLOSED: 0, OPEN: 1, LOCKED: 2 };
const DIRECTION = { BOTH: 0, LEFT: 1, RIGHT: 2 };

const _SENSE_KINDS = { [SENSE.LIMITED]: "limited", [SENSE.NORMAL]: "normal", [SENSE.PROXIMITY]: "proximity", [SENSE.DISTANCE]: "distance" };

/**
 * @typedef {{x: number, y: number}} Point
 * @typedef {object} Wall
 * @property {Point} a
 * @property {Point} b
 * @property {number} sense       its sound restriction, a value of CONST.EDGE_SENSE_TYPES
 * @property {number} [door]      a value of CONST.WALL_DOOR_TYPES
 * @property {number} [ds]        its door state, a value of CONST.WALL_DOOR_STATES
 * @property {number} [dir]       for a one-way wall, a value of CONST.EDGE_DIRECTIONS
 * @property {number} [threshold] for Proximity and Distance walls, the threshold distance in pixels
 */

/* -------------------------------------------- */
/*  Muffling                                    */
/* -------------------------------------------- */

/**
 * Which muffle setting a wall falls under: doors by their state, everything else by its sound restriction
 * @param {Wall} wall
 * @returns {string | null} a value of WALL_KINDS, or null if sound passes it untouched
 */
export function wall_kind(wall) {
  if (!wall.sense || wall.ds === DOOR_STATE.OPEN) return null;
  if (wall.door === DOOR.SECRET) return "secret";
  if (wall.door === DOOR.DOOR) return wall.ds === DOOR_STATE.LOCKED ? "locked" : "door";
  return _SENSE_KINDS[wall.sense] ?? "normal";
}

/**
 * What a wall would be called by someone who can't know it's a secret door
 * @param {Wall} wall
 * @returns {string | null}
 */
function _plain_kind(wall) {
  return wall.door === DOOR.SECRET ? (_SENSE_KINDS[wall.sense] ?? "normal") : wall_kind(wall);
}

/**
 * Several crossings compound: each takes its share of what the ones before let through, and one that blocks
 * completely blocks the lot
 * @param {Array<number>} amounts muffle amounts from 0 to 1
 * @returns {number} from 0 to 1
 */
export function combine_muffle(amounts) {
  let passed = 1;
  for (const amount of amounts) passed *= 1 - Math.min(1, Math.max(0, amount));
  return 1 - passed;
}

/**
 * The low-pass cutoff for a muffle amount. Muffling is mostly this: 0 is no filter, half is about 2.4 kHz, which
 * keeps speech intelligible, and three quarters is under 1 kHz, where it's a murmur. Foundry's own muffle effect
 * tops out at 1 kHz, which is why it isn't used for voices.
 * @param {number} muffle from 0 to 1
 * @returns {number} Hz
 */
export function muffle_cutoff(muffle) {
  if (!(muffle > 0)) return OPEN_CUTOFF;
  return OPEN_CUTOFF * Math.pow(CLOSED_CUTOFF / OPEN_CUTOFF, Math.min(1, muffle));
}

/**
 * How much quieter a muffle amount makes a voice, on top of the filter: a little, rising steeply only close to
 * fully blocked. Players already find proximity voices quiet, so walls change tone much more than loudness.
 * @param {number} muffle from 0 to 1
 * @returns {number} a gain from 1 down to 0
 */
export function muffle_gain(muffle) {
  const m = Math.min(1, Math.max(0, muffle));
  return (1 - 0.3 * m) * (1 - Math.pow(m, 6));
}

/**
 * The same for the old audio path, which has no filter: there, muffled can only mean quieter
 * @param {number} muffle from 0 to 1
 * @returns {number} a gain from 1 down to 0
 */
export function muffle_gain_legacy(muffle) {
  return 1 - Math.min(1, Math.max(0, muffle));
}

/**
 * How loud a voice is after travelling a distance, the way Foundry fades ambient sounds: cosine easing over the
 * radius, with height counted as well
 * @param {number} distance along the ground, in pixels
 * @param {number} height the difference in elevation, in pixels
 * @param {number} radius how far the voice carries, in pixels
 * @returns {number} from 0 to 1
 */
export function distance_falloff(distance, height, radius) {
  if (distance === 0 && height === 0) return 1;
  if (!(radius > 0) || distance > radius || height > radius + 1e-8) return 0;
  const dv = 1 - ((1 - (distance / radius)) * (1 - (Math.min(height, radius) / radius)));
  return (Math.cos(Math.PI * dv) + 1) * 0.5;
}

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

/**
 * Where segment p-q meets segment a-b
 * @returns {{t: number, u: number} | null} how far along p-q and along a-b, each from 0 to 1 when the segments
 *   really cross; null when they're parallel
 */
function _intersection(p, q, a, b) {
  const rx = q.x - p.x, ry = q.y - p.y;
  const sx = b.x - a.x, sy = b.y - a.y;
  const cross = rx * sy - ry * sx;
  if (Math.abs(cross) < 1e-9) return null;
  const ax = a.x - p.x, ay = a.y - p.y;
  return { t: (ax * sy - ay * sx) / cross, u: (ax * ry - ay * rx) / cross };
}

/**
 * The shortest distance from a point to a segment
 */
function _distance_to_segment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Whether a wall stands in the way of sound from this origin, by the rules Foundry's own sound polygons use
 * (ClockwiseSweepPolygon#_testEdgeInclusion): a one-way wall only blocks from one side, a Proximity wall lets
 * sound through from close by, and a Distance wall from far away.
 * @param {Wall} wall
 * @param {Point} origin where the sound comes from
 * @returns {boolean}
 */
export function wall_applies(wall, origin) {
  if (!wall_kind(wall)) return false;
  // foundry.utils.orient2dFast
  const orientation = (wall.a.y - origin.y) * (wall.b.x - origin.x) - (wall.a.x - origin.x) * (wall.b.y - origin.y);
  if (orientation === 0) return false;
  if (wall.dir && wall.dir === (orientation < 0 ? DIRECTION.LEFT : DIRECTION.RIGHT)) return false;
  if (wall.threshold && wall.sense >= SENSE.PROXIMITY) {
    const distance = _distance_to_segment(origin, wall.a, wall.b);
    if (wall.sense === SENSE.PROXIMITY ? distance < wall.threshold : distance > wall.threshold) return false;
  }
  return true;
}

/**
 * The walls a straight line from a speaker to a listener goes through, nearest the speaker first
 * @param {Point} origin the speaker
 * @param {Point} destination the listener
 * @param {Array<Wall>} walls
 * @returns {Array<{wall: Wall, kind: string, t: number, x: number, y: number}>}
 */
export function line_crossings(origin, destination, walls) {
  const crossings = [];
  const min_x = Math.min(origin.x, destination.x), max_x = Math.max(origin.x, destination.x);
  const min_y = Math.min(origin.y, destination.y), max_y = Math.max(origin.y, destination.y);
  for (const wall of walls) {
    if (Math.max(wall.a.x, wall.b.x) < min_x || Math.min(wall.a.x, wall.b.x) > max_x) continue;
    if (Math.max(wall.a.y, wall.b.y) < min_y || Math.min(wall.a.y, wall.b.y) > max_y) continue;
    if (!wall_applies(wall, origin)) continue;
    const hit = _intersection(origin, destination, wall.a, wall.b);
    if (!hit || hit.t <= 0 || hit.t >= 1 || hit.u < 0 || hit.u > 1) continue;
    crossings.push({
      wall, kind: wall_kind(wall), t: hit.t,
      x: origin.x + hit.t * (destination.x - origin.x), y: origin.y + hit.t * (destination.y - origin.y)
    });
  }
  return crossings.sort((a, b) => a.t - b.t);
}

/**
 * The combined muffle of a line's crossings. Walls that meet where the line crosses them (a corner, or two walls
 * drawn end to end) count once, as the more muffling of them.
 * @param {ReturnType<typeof line_crossings>} crossings
 * @param {Record<string, number>} muffle amounts by wall kind
 * @returns {{muffle: number, counts: Record<string, number>, plain: Record<string, number>}} counts: how many of
 *   each kind were crossed; plain: the same with secret doors counted as the walls they look like
 */
function _crossings_muffle(crossings, muffle) {
  const places = new Map();
  for (const crossing of crossings) {
    const key = Math.round(crossing.x) + "," + Math.round(crossing.y);
    const amount = muffle[crossing.kind] ?? 0;
    const best = places.get(key);
    if (!best || amount > best.amount) places.set(key, { amount, crossing });
  }
  const counts = {}, plain = {};
  for (const { crossing } of places.values()) {
    counts[crossing.kind] = (counts[crossing.kind] ?? 0) + 1;
    const plain_kind = _plain_kind(crossing.wall);
    plain[plain_kind] = (plain[plain_kind] ?? 0) + 1;
  }
  return { muffle: combine_muffle(Array.from(places.values(), place => place.amount)), counts, plain };
}

/* -------------------------------------------- */
/*  Routes around walls                         */
/* -------------------------------------------- */

/**
 * @typedef {object} RouteGraph
 * @property {Array<Wall & {min_x: number, max_x: number, min_y: number, max_y: number}>} walls
 * @property {Array<Point>} nodes  the points a route can turn at
 * @property {Map<number, boolean>} visible  which pairs of nodes can see each other, filled in as it's asked
 */

/**
 * Prepares the walls of a level for route finding: a visibility graph. Sound bending round an obstacle turns at
 * its outside corners and loose ends, so those are the graph's nodes, each nudged a little way out from the wall
 * so that lines between them clear it. Which nodes can see each other is worked out on demand and remembered.
 * @param {Array<Wall>} walls the walls that block a route; open doors and walls set to 0% muffle aren't among them
 * @param {object} [options]
 * @param {number} [options.offset] how far out from a corner its node sits, in pixels
 * @returns {RouteGraph}
 */
export function build_graph(walls, { offset = 10 } = {}) {
  const boxed = [];
  const corners = new Map();
  const add_end = (point, other) => {
    const key = Math.round(point.x) + "," + Math.round(point.y);
    let corner = corners.get(key);
    if (!corner) corners.set(key, corner = { x: point.x, y: point.y, angles: [] });
    corner.angles.push(Math.atan2(other.y - point.y, other.x - point.x));
  };
  for (const wall of walls) {
    if (wall.a.x === wall.b.x && wall.a.y === wall.b.y) continue;
    boxed.push({
      ...wall,
      min_x: Math.min(wall.a.x, wall.b.x), max_x: Math.max(wall.a.x, wall.b.x),
      min_y: Math.min(wall.a.y, wall.b.y), max_y: Math.max(wall.a.y, wall.b.y)
    });
    add_end(wall.a, wall.b);
    add_end(wall.b, wall.a);
  }
  const nodes = [];
  for (const corner of corners.values()) {
    const angles = corner.angles.sort((a, b) => a - b);
    for (let i = 0; i < angles.length; i++) {
      // the open space between one wall and the next one round. Only where it's wider than a straight line is
      // this a corner to go round; a single wall's end is open all the way round.
      let gap = (i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI) - angles[i];
      if (angles.length === 1) gap = 2 * Math.PI;
      if (gap <= Math.PI + 0.05) continue;
      const out = angles[i] + gap / 2;
      const node = { x: corner.x + Math.cos(out) * offset, y: corner.y + Math.sin(out) * offset };
      // a node that another wall cuts off from its own corner is inside something, e.g. the thickness of a wall
      if (_is_clear(corner, node, boxed)) nodes.push(node);
    }
  }
  return { walls: boxed, nodes, visible: new Map() };
}

/**
 * Whether the straight line between two points misses every wall. Touching a wall's end counts as hitting it.
 * @param {Point} p
 * @param {Point} q
 * @param {RouteGraph["walls"]} walls
 * @param {{tests: number}} [budget] counts the walls looked at
 * @returns {boolean}
 */
function _is_clear(p, q, walls, budget) {
  const min_x = Math.min(p.x, q.x), max_x = Math.max(p.x, q.x);
  const min_y = Math.min(p.y, q.y), max_y = Math.max(p.y, q.y);
  if (budget) budget.tests += walls.length;
  for (const wall of walls) {
    if (wall.max_x < min_x || wall.min_x > max_x || wall.max_y < min_y || wall.min_y > max_y) continue;
    const hit = _intersection(p, q, wall.a, wall.b);
    if (hit && hit.t > 1e-6 && hit.t < 1 - 1e-6 && hit.u >= -1e-6 && hit.u <= 1 + 1e-6) return false;
  }
  return true;
}

/**
 * The shortest route from a speaker to a listener through open space, no longer than the voice carries.
 * @param {RouteGraph} graph
 * @param {Point} origin the speaker
 * @param {Point} destination the listener
 * @param {number} max_length the longest route worth finding, in pixels: the speaker's radius
 * @param {object} [options]
 * @param {number} [options.max_nodes] corners considered, nearest first, so a huge map can't stall the page
 * @param {number} [options.max_tests] wall checks allowed before giving up
 * @returns {{length: number, bends: number, points: Array<Point>} | null} null when there's no route in reach
 */
export function find_route(graph, origin, destination, max_length, { max_nodes = 300, max_tests = 400000 } = {}) {
  const direct = Math.hypot(destination.x - origin.x, destination.y - origin.y);
  if (!(direct <= max_length)) return null;
  // any point on a route this short lies in an ellipse round the two ends; only walls and corners in it matter
  const reach = Math.sqrt(Math.max(0, max_length * max_length - direct * direct)) / 2 + 1;
  const min_x = Math.min(origin.x, destination.x) - reach, max_x = Math.max(origin.x, destination.x) + reach;
  const min_y = Math.min(origin.y, destination.y) - reach, max_y = Math.max(origin.y, destination.y) + reach;
  const walls = graph.walls.filter(wall => wall.max_x >= min_x && wall.min_x <= max_x && wall.max_y >= min_y && wall.min_y <= max_y);
  const budget = { tests: 0 };
  if (_is_clear(origin, destination, walls, budget)) return { length: direct, bends: 0, points: [origin, destination] };

  let candidates = [];
  for (let index = 0; index < graph.nodes.length; index++) {
    const node = graph.nodes[index];
    const detour = Math.hypot(node.x - origin.x, node.y - origin.y) + Math.hypot(node.x - destination.x, node.y - destination.y);
    if (detour <= max_length) candidates.push({ index, detour });
  }
  if (candidates.length > max_nodes) candidates = candidates.sort((a, b) => a.detour - b.detour).slice(0, max_nodes);

  // A* over: 0 the speaker, 1..n the corners, n + 1 the listener
  const points = [origin, ...candidates.map(candidate => graph.nodes[candidate.index]), destination];
  const last = points.length - 1;
  const total = graph.nodes.length;
  const sees = (i, j) => {
    if (i === 0 || j === 0 || i === last || j === last) return _is_clear(points[i], points[j], walls, budget);
    const a = candidates[i - 1].index, b = candidates[j - 1].index;
    const key = a < b ? a * total + b : b * total + a;
    let visible = graph.visible.get(key);
    if (visible === undefined) graph.visible.set(key, visible = _is_clear(points[i], points[j], walls, budget));
    return visible;
  };
  const to_end = points.map(point => Math.hypot(point.x - destination.x, point.y - destination.y));
  const travelled = new Array(points.length).fill(Infinity);
  const previous = new Array(points.length).fill(-1);
  const done = new Array(points.length).fill(false);
  travelled[0] = 0;
  let found = false;
  while (!found && budget.tests <= max_tests) {
    // the unvisited point with the shortest possible route through it
    let current = -1;
    for (let i = 0; i < points.length; i++) {
      if (done[i] || travelled[i] === Infinity) continue;
      if (current < 0 || travelled[i] + to_end[i] < travelled[current] + to_end[current]) current = i;
    }
    if (current < 0 || travelled[current] + to_end[current] > max_length) return null;
    if (current === last) {
      found = true;
      break;
    }
    done[current] = true;
    for (let next = 1; next < points.length; next++) {
      if (done[next]) continue;
      const length = travelled[current] + Math.hypot(points[next].x - points[current].x, points[next].y - points[current].y);
      if (length >= travelled[next] || length + to_end[next] > max_length) continue;
      if (!sees(current, next)) continue;
      travelled[next] = length;
      previous[next] = current;
    }
  }
  if (!found) return null;

  const route = [];
  for (let i = last; i >= 0; i = previous[i]) route.unshift(points[i]);
  let bends = 0;
  for (let i = 1; i < route.length - 1; i++) {
    const before = Math.atan2(route[i].y - route[i - 1].y, route[i].x - route[i - 1].x);
    const after = Math.atan2(route[i + 1].y - route[i].y, route[i + 1].x - route[i].x);
    let turn = Math.abs(after - before);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > BEND_ANGLE) bends++;
  }
  return { length: travelled[last], bends, points: route };
}

/* -------------------------------------------- */
/*  What the listener hears                     */
/* -------------------------------------------- */

/**
 * @typedef {object} Hearing
 * @property {number} volume    how loud by distance alone, from 0 to 1; 0 when out of range or fully blocked
 * @property {number} muffle    how muffled, from 0 to 1
 * @property {"open" | "through" | "around" | "blocked" | "range"} via  open: nothing in the way; through: straight
 *   through walls; around: round them; blocked: in range, but no way through or round; range: too far
 * @property {Point} [from]     where the sound seems to come from, for left/right placement
 * @property {Record<string, number>} [walls]  for "through" and "blocked": how many of each wall kind the line crosses
 * @property {Record<string, number>} [plainWalls]  the same, with secret doors counted as the walls they look like
 * @property {number} [length]  for "around": the route's length in pixels
 * @property {number} [bends]   for "around": how many times the route turns
 */

/**
 * The straight line: nothing in the way, or through walls, muffled by each
 * @param {object} path
 * @param {Point} path.origin the speaker
 * @param {Point} path.destination the listener
 * @param {number} path.radius how far the voice carries, in pixels
 * @param {number} [path.height] the difference in elevation, in pixels
 * @param {Array<Wall>} path.walls
 * @param {Record<string, number>} path.muffle amounts by wall kind
 * @returns {Hearing}
 */
export function direct_sound({ origin, destination, radius, height = 0, walls, muffle }) {
  const distance = Math.hypot(destination.x - origin.x, destination.y - origin.y);
  const volume = distance_falloff(distance, height, radius);
  if (volume === 0) return { volume: 0, muffle: 0, via: "range" };
  // walls a GM has set to 0% are as good as absent
  const crossings = line_crossings(origin, destination, walls).filter(crossing => (muffle[crossing.kind] ?? 0) > 0);
  if (!crossings.length) return { volume, muffle: 0, via: "open", from: origin };
  const crossed = _crossings_muffle(crossings, muffle);
  const blocked = crossed.muffle >= BLOCKED_AT;
  return {
    volume: blocked ? 0 : volume, muffle: crossed.muffle, via: blocked ? "blocked" : "through", from: origin,
    walls: crossed.counts, plainWalls: crossed.plain
  };
}

/**
 * A route round the walls: as loud as its length allows, and a little muffled by each bend
 * @param {ReturnType<typeof find_route>} route
 * @param {object} path
 * @param {number} path.radius
 * @param {number} [path.height]
 * @param {number} [path.bend_muffle] the muffle amount of one bend
 * @returns {Hearing | null} null when there's no route, or it's too long to hear anything
 */
export function routed_sound(route, { radius, height = 0, bend_muffle = BEND_MUFFLE }) {
  if (!route) return null;
  const volume = distance_falloff(route.length, height, radius);
  if (volume === 0) return null;
  return {
    volume, muffle: combine_muffle(new Array(route.bends).fill(bend_muffle)), via: route.bends ? "around" : "open",
    // the last leg of the route is the direction it arrives from
    from: route.points[route.points.length - 2], length: route.length, bends: route.bends
  };
}

/**
 * How well a voice comes across: how loud it ends up, weighted towards the less muffled
 * @param {Hearing | null} hearing
 * @returns {number}
 */
export function clarity(hearing) {
  if (!hearing) return 0;
  return hearing.volume * muffle_gain(hearing.muffle) * (1 - hearing.muffle / 2);
}

/**
 * Everything together: what a listener hears of a speaker
 * @param {Parameters<typeof direct_sound>[0] & {graph?: RouteGraph, bend_muffle?: number}} path graph: the walls to
 *   route round, from build_graph; leave it out and only the straight line is tried
 * @returns {Hearing}
 */
export function propagate(path) {
  const direct = direct_sound(path);
  if (direct.via === "open" || direct.via === "range" || !path.graph) return direct;
  const around = routed_sound(find_route(path.graph, path.origin, path.destination, path.radius), path);
  return clarity(around) > clarity(direct) ? around : direct;
}

/**
 * Where a voice sits between your ears: -1 hard left, 0 centre, 1 hard right. Only the left/right part of the
 * direction counts, and a voice right on top of you stays centred instead of flipping sides as it passes.
 * @param {Point} listener
 * @param {Point} from where the sound seems to come from
 * @param {number} strength from 0 (always centred) to 1
 * @param {number} near within this many pixels the placement eases to the centre
 * @returns {number}
 */
export function pan_for(listener, from, strength, near) {
  const dx = from.x - listener.x, dy = from.y - listener.y;
  const distance = Math.max(Math.hypot(dx, dy), near, 1e-6);
  return Math.max(-1, Math.min(1, strength * dx / distance));
}

const _KIND_NAMES = {
  limited: ["limited wall", "limited walls"], normal: ["wall", "walls"], proximity: ["proximity wall", "proximity walls"],
  distance: ["distance wall", "distance walls"], door: ["closed door", "closed doors"], locked: ["locked door", "locked doors"],
  secret: ["secret door", "secret doors"]
};

/**
 * How someone is heard, in words: "around a corner (route 14 tiles, 2 bends)", "through 1 closed door (muffled 50%)"
 * @param {Hearing} hearing
 * @param {object} [options]
 * @param {number} [options.grid] pixels per tile, for route lengths
 * @param {boolean} [options.redact] for a player's own view: don't name secret doors
 * @returns {string} empty when there's nothing to say, i.e. out of range
 */
export function describe_hearing(hearing, { grid = 100, redact = false } = {}) {
  if (!hearing || hearing.via === "range") return "";
  if (hearing.via === "open") return "in the open";
  if (hearing.via === "around") {
    const tiles = Math.round(hearing.length / grid);
    return "around " + (hearing.bends === 1 ? "a corner" : "corners") + " (route " + tiles + " tile" + (tiles === 1 ? "" : "s")
      + ", " + hearing.bends + " bend" + (hearing.bends === 1 ? "" : "s") + ")";
  }
  const counts = (redact ? hearing.plainWalls : hearing.walls) ?? {};
  const parts = WALL_KINDS.filter(kind => counts[kind]).map(kind => counts[kind] + " " + _KIND_NAMES[kind][counts[kind] === 1 ? 0 : 1]);
  const walls = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts.at(-1) : parts[0] ?? "walls";
  if (hearing.via === "blocked") return "blocked by " + walls;
  return "through " + walls + " (muffled " + Math.round(hearing.muffle * 100) + "%)";
}
