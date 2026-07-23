// Track history — every generated song is kept in IndexedDB so it can be
// replayed, saved to disk, or auto-purged per the retention setting.

const DB_NAME = "muse-machine";

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("tracks", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function addTrack(t) {
  const d = await idb();
  return new Promise((res, rej) => {
    const tx = d.transaction("tracks", "readwrite");
    tx.objectStore("tracks").put(t);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function allTracks() {
  const d = await idb();
  return new Promise((res, rej) => {
    const rq = d.transaction("tracks").objectStore("tracks").getAll();
    rq.onsuccess = () => res(rq.result.sort((a, b) => b.ts - a.ts));
    rq.onerror = () => rej(rq.error);
  });
}

export async function deleteTrack(id) {
  const d = await idb();
  return new Promise((res, rej) => {
    const tx = d.transaction("tracks", "readwrite");
    tx.objectStore("tracks").delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// Removes tracks older than maxAgeMs. Returns how many were purged.
export async function purgeOlderThan(maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  const tracks = await allTracks();
  const old = tracks.filter((t) => t.ts < cutoff);
  for (const t of old) await deleteTrack(t.id);
  return old.length;
}
