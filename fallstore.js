// FallStore · content-addressed storage · IPFS-lite · SHA-256 CIDs
// AI-Native Solutions · MIT
// CID format: sha256:<32-char-base32-lowercase-truncated-to-52>
// Truthfully: full sha256 base32 = 52 chars (256/5 rounded up)

const DB_NAME = 'fallstore-v1';
const STORE = 'blobs';
const META = 'meta';
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'; // RFC4648 lowercase

function b32encode(bytes){
  let bits = 0, value = 0, out = '';
  for (const b of bytes){
    value = (value << 8) | b; bits += 8;
    while (bits >= 5){ out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

async function sha256(bytes){
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

async function toBytes(input){
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
  if (typeof input === 'string') return new TextEncoder().encode(input);
  throw new TypeError('FallStore: input must be Uint8Array, ArrayBuffer, Blob, or string');
}

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(META))  db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, stores, mode){
  const t = db.transaction(stores, mode);
  return { t, stores: stores.map(s => t.objectStore(s)) };
}

function pr(req){ return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

// Event emitter for progress
const listeners = new Set();
export function onProgress(fn){ listeners.add(fn); return () => listeners.delete(fn); }
function emit(evt){ for (const fn of listeners) try { fn(evt); } catch(e){} }

export async function computeCID(input){
  const bytes = await toBytes(input);
  const total = bytes.byteLength;
  emit({ type: 'hash-start', size: total });
  const digest = await sha256(bytes);
  const cid = 'sha256:' + b32encode(digest);
  emit({ type: 'hash-end', cid, size: total });
  return cid;
}

export async function store(input){
  const bytes = await toBytes(input);
  const cid = await computeCID(bytes);
  const db = await openDB();
  try {
    const { t, stores: [blobs, meta] } = tx(db, [STORE, META], 'readwrite');
    const existing = await pr(meta.get(cid));
    if (existing){
      emit({ type: 'store-skip', cid, reason: 'exists' });
      return cid;
    }
    emit({ type: 'store-start', cid, size: bytes.byteLength });
    await pr(blobs.put(bytes, cid));
    await pr(meta.put({ cid, size: bytes.byteLength, storedAt: Date.now(), pinned: false }, cid));
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    emit({ type: 'store-end', cid, size: bytes.byteLength });
    return cid;
  } finally { db.close(); }
}

export async function storeAll(items){
  const cids = [];
  for (let i = 0; i < items.length; i++){
    emit({ type: 'batch-progress', done: i, total: items.length });
    cids.push(await store(items[i]));
  }
  emit({ type: 'batch-progress', done: items.length, total: items.length });
  return cids;
}

export async function retrieve(cid){
  const db = await openDB();
  try {
    const { stores: [blobs] } = tx(db, [STORE], 'readonly');
    const v = await pr(blobs.get(cid));
    return v ? new Uint8Array(v) : null;
  } finally { db.close(); }
}

export async function has(cid){
  const db = await openDB();
  try {
    const { stores: [meta] } = tx(db, [META], 'readonly');
    const v = await pr(meta.get(cid));
    return !!v;
  } finally { db.close(); }
}

export async function list(){
  const db = await openDB();
  try {
    const { stores: [meta] } = tx(db, [META], 'readonly');
    const keys = await pr(meta.getAllKeys());
    const vals = await pr(meta.getAll());
    return vals.map((v, i) => ({ cid: keys[i], size: v.size, storedAt: v.storedAt, pinned: !!v.pinned }));
  } finally { db.close(); }
}

export async function remove(cid){
  const db = await openDB();
  try {
    const { t, stores: [blobs, meta] } = tx(db, [STORE, META], 'readwrite');
    const m = await pr(meta.get(cid));
    if (!m) return false;
    await pr(blobs.delete(cid));
    await pr(meta.delete(cid));
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    emit({ type: 'remove', cid });
    return true;
  } finally { db.close(); }
}

export async function verify(cid, input){
  const computed = await computeCID(input);
  return computed === cid;
}

export async function pin(cid){
  const db = await openDB();
  try {
    const { t, stores: [meta] } = tx(db, [META], 'readwrite');
    const m = await pr(meta.get(cid));
    if (!m) return false;
    m.pinned = true;
    await pr(meta.put(m, cid));
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    emit({ type: 'pin', cid });
    return true;
  } finally { db.close(); }
}

export async function unpin(cid){
  const db = await openDB();
  try {
    const { t, stores: [meta] } = tx(db, [META], 'readwrite');
    const m = await pr(meta.get(cid));
    if (!m) return false;
    m.pinned = false;
    await pr(meta.put(m, cid));
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    emit({ type: 'unpin', cid });
    return true;
  } finally { db.close(); }
}

export async function gc(maxAgeMs){
  const now = Date.now();
  const all = await list();
  let freed = 0;
  for (const item of all){
    if (item.pinned) continue;
    if (now - item.storedAt > maxAgeMs){
      const ok = await remove(item.cid);
      if (ok) freed++;
    }
  }
  emit({ type: 'gc', freed });
  return freed;
}

export async function quota(){
  if (navigator.storage && navigator.storage.estimate){
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  }
  return { usage: 0, quota: 0 };
}

export default {
  store, storeAll, retrieve, has, list, remove, computeCID, verify,
  pin, unpin, gc, quota, onProgress
};
