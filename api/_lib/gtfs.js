// Zero-dependency readers for the three formats Golden Gate Transit publishes:
// a ZIP of GTFS CSV files, and GTFS-Realtime protobuf feeds.
"use strict";
const zlib = require("zlib");

/* ---------- ZIP (central directory → inflateRaw) ---------- */

function unzip(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip: no end-of-central-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip: bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).split("/").pop();
    p += 46 + nameLen + extraLen + commentLen;
    if (wanted && !wanted.includes(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    out[name] = method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
  }
  return out;
}

/* ---------- CSV (RFC 4180, trims fields, strips BOM) ---------- */

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field.trim()); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim()); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field.trim()); rows.push(row); }
  const head = rows.shift() || [];
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/* ---------- Protobuf wire format ---------- */

class Reader {
  constructor(buf, start = 0, end = buf.length) { this.b = buf; this.p = start; this.end = end; }
  more() { return this.p < this.end; }
  // Returns the varint as a JS number (exact below 2^53) plus its low 32 bits as a signed int,
  // which is how negative int32 fields (e.g. GTFS-RT `delay`) come out right.
  varint() {
    let num = 0, mul = 1, low = 0, shift = 0, byte;
    do {
      if (this.p >= this.end) throw new Error("pb: truncated varint");
      byte = this.b[this.p++];
      num += (byte & 0x7f) * mul;
      if (shift < 32) low |= (byte & 0x7f) << shift;
      mul *= 128; shift += 7;
    } while (byte & 0x80);
    return { num, int32: low | 0 };
  }
  bytes() { const n = this.varint().num; const s = this.p; this.p += n; return [s, this.p]; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.p += 4;
    else throw new Error("pb: unsupported wire type " + wire);
  }
  // Iterate fields: cb(fieldNumber, wireType) must consume the value or return false to skip it.
  each(cb) {
    while (this.more()) {
      const key = this.varint().num;
      const f = Math.floor(key / 8), w = key & 7;
      if (cb(f, w) === false) this.skip(w);
    }
  }
}

const str = (r) => { const [s, e] = r.bytes(); return r.b.toString("utf8", s, e); };
const sub = (r) => { const [s, e] = r.bytes(); return new Reader(r.b, s, e); };
const f32 = (r) => { const v = r.b.readFloatLE(r.p); r.p += 4; return v; };
const f64 = (r) => { const v = r.b.readDoubleLE(r.p); r.p += 8; return v; };

function tripDescriptor(r) {
  const t = {};
  r.each((f, w) => {
    if (f === 1 && w === 2) t.tripId = str(r);
    else if (f === 2 && w === 2) t.startTime = str(r);
    else if (f === 3 && w === 2) t.startDate = str(r);
    else if (f === 4 && w === 0) t.rel = r.varint().num; // 3 = CANCELED
    else if (f === 5 && w === 2) t.routeId = str(r);
    else if (f === 6 && w === 0) t.directionId = r.varint().num;
    else return false;
  });
  return t;
}
function vehicleDescriptor(r) {
  const v = {};
  r.each((f, w) => {
    if (f === 1 && w === 2) v.id = str(r);
    else if (f === 2 && w === 2) v.label = str(r);
    else return false;
  });
  return v;
}
function stopTimeEvent(r) {
  const e = {};
  r.each((f, w) => {
    if (f === 1 && w === 0) e.delay = r.varint().int32;
    else if (f === 2 && w === 0) e.time = r.varint().num;
    else return false;
  });
  return e;
}
function stopTimeUpdate(r) {
  const u = {};
  r.each((f, w) => {
    if (f === 1 && w === 0) u.seq = r.varint().num;
    else if (f === 2 && w === 2) u.arr = stopTimeEvent(sub(r));
    else if (f === 3 && w === 2) u.dep = stopTimeEvent(sub(r));
    else if (f === 4 && w === 2) u.stopId = str(r);
    else if (f === 5 && w === 0) u.rel = r.varint().num; // 1 = SKIPPED, 2 = NO_DATA
    else return false;
  });
  return u;
}
function tripUpdate(r) {
  const t = { stops: [] };
  r.each((f, w) => {
    if (f === 1 && w === 2) t.trip = tripDescriptor(sub(r));
    else if (f === 2 && w === 2) t.stops.push(stopTimeUpdate(sub(r)));
    else if (f === 3 && w === 2) t.vehicle = vehicleDescriptor(sub(r));
    else if (f === 4 && w === 0) t.ts = r.varint().num;
    else if (f === 5 && w === 0) t.delay = r.varint().int32;
    else return false;
  });
  return t;
}
function position(r) {
  const p = {};
  r.each((f, w) => {
    if (f === 1 && w === 5) p.lat = f32(r);
    else if (f === 2 && w === 5) p.lon = f32(r);
    else if (f === 3 && w === 5) p.bearing = f32(r);
    else if (f === 4 && w === 1) p.odometer = f64(r);
    else if (f === 5 && w === 5) p.speed = f32(r);
    else return false;
  });
  return p;
}
function vehiclePosition(r) {
  const v = {};
  r.each((f, w) => {
    if (f === 1 && w === 2) v.trip = tripDescriptor(sub(r));
    else if (f === 2 && w === 2) v.pos = position(sub(r));
    else if (f === 3 && w === 0) v.seq = r.varint().num;
    else if (f === 4 && w === 0) v.status = r.varint().num; // 0 INCOMING_AT, 1 STOPPED_AT, 2 IN_TRANSIT_TO
    else if (f === 5 && w === 0) v.ts = r.varint().num;
    else if (f === 7 && w === 2) v.stopId = str(r);
    else if (f === 8 && w === 2) v.vehicle = vehicleDescriptor(sub(r));
    else if (f === 9 && w === 0) v.occupancy = r.varint().num;
    else return false;
  });
  return v;
}

function decodeFeed(buf) {
  const r = new Reader(buf);
  const feed = { header: {}, tripUpdates: [], vehicles: [] };
  r.each((f, w) => {
    if (f === 1 && w === 2) {
      const h = sub(r);
      h.each((g, x) => {
        if (g === 1 && x === 2) feed.header.version = str(h);
        else if (g === 3 && x === 0) feed.header.ts = h.varint().num;
        else return false;
      });
    } else if (f === 2 && w === 2) {
      const e = sub(r);
      let deleted = false, tu = null, vp = null;
      e.each((g, x) => {
        if (g === 2 && x === 0) deleted = !!e.varint().num;
        else if (g === 3 && x === 2) tu = tripUpdate(sub(e));
        else if (g === 4 && x === 2) vp = vehiclePosition(sub(e));
        else return false;
      });
      if (!deleted && tu) feed.tripUpdates.push(tu);
      if (!deleted && vp) feed.vehicles.push(vp);
    } else return false;
  });
  return feed;
}

module.exports = { unzip, parseCsv, decodeFeed };
