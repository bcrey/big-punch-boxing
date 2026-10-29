// IndexedDB keeps full-size photos and editable outlines when the API is unavailable.
const FighterStorage = (() => {
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('bam-bam-boxing', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('roster');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => { database = null; throw error; });
    return database;
  }
  async function read() {
    try {
      const db = await open();
      const saved = await new Promise((resolve, reject) => {
        const request = db.transaction('roster').objectStore('roster').get('fighters');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (Array.isArray(saved)) return saved;
    } catch (_) { /* Older browsers may still have the original localStorage roster. */ }
    try { return JSON.parse(localStorage.getItem('boxingRoster') || 'null'); } catch (_) { return null; }
  }
  async function write(fighters) {
    const snapshot = structuredClone(fighters);
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('roster', 'readwrite');
        transaction.objectStore('roster').put(snapshot, 'fighters');
        transaction.oncomplete = resolve;
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
      return true;
    } catch (_) {
      try { localStorage.setItem('boxingRoster', JSON.stringify(snapshot)); return true; }
      catch (_) { return false; }
    }
  }
  return { read, write };
})();
