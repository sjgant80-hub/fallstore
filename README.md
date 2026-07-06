# FallStore

**Content-addressed storage. IPFS-lite in one file.**

Part of the AI-Native Solutions estate.

Live demo: https://sjgant80-hub.github.io/fallstore/

---

## What it does

You hand FallStore some bytes — a file, a string, a Blob. It hashes them with SHA-256 and gives you back a **CID** (content ID) like `sha256:abcxyz…`.

Later, anyone with that CID can ask for the bytes back and **verify they got exactly what you sent**. If the hash matches, the file is authentic. No trust, no signatures needed (though you can layer FallSignature on top for authorship).

That's it. It's what IPFS does, but small enough to read in one sitting and drop into any browser app.

## Why it matters

Names lie. `report.pdf` on my machine and `report.pdf` on yours could be different files. But `sha256:xyz…` is the file — the ID *is* the fingerprint. If you receive bytes that hash to that CID, they are the file. Full stop.

Combined with signatures, you get portable, verifiable, tamper-evident pieces you can pass around any channel.

## API

```js
import FS from './fallstore.js';

const cid = await FS.store('hello world');     // sha256:...
const bytes = await FS.retrieve(cid);          // Uint8Array
const ok = await FS.verify(cid, 'hello world'); // true
await FS.pin(cid);                             // survives GC
const items = await FS.list();                 // [{cid, size, storedAt, pinned}]
await FS.gc(60 * 60 * 1000);                   // remove unpinned older than 1h
```

Full surface: `store`, `storeAll`, `retrieve`, `has`, `list`, `remove`, `computeCID`, `verify`, `pin`, `unpin`, `gc`, `quota`, `onProgress`.

## Storage

Everything lives in IndexedDB (`fallstore-v1`). Nothing leaves your browser. Nothing is uploaded anywhere. This is a client-side library.

## License

MIT. Simon Gant · AI-Native Solutions · 2026.
