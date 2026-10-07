/* =========================================================
   db.js — Capa de datos (IndexedDB) de "Mis Finanzas"
   Almacenes:
     movs   : movimientos {id, tipo, monto, fecha, categoria, desc, fotoId, listaId, creado}
     fotos  : comprobantes {id, blob}
     listas : listas de compras {id, nombre, fecha, items[], cerrada, movId}
     config : pares clave/valor {key, value}
   ========================================================= */
const DB = (() => {
  const NOMBRE = 'misfinanzas';
  const VERSION = 1;
  let conexion = null;

  function abrir() {
    if (conexion) return Promise.resolve(conexion);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NOMBRE, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('movs')) {
          const s = db.createObjectStore('movs', { keyPath: 'id' });
          s.createIndex('fecha', 'fecha');
        }
        if (!db.objectStoreNames.contains('fotos')) db.createObjectStore('fotos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('listas')) db.createObjectStore('listas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'key' });
      };
      req.onsuccess = () => { conexion = req.result; resolve(conexion); };
      req.onerror = () => reject(req.error || new Error('No se pudo abrir la base de datos'));
    });
  }

  async function tx(store, modo, fn) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, modo);
      const s = t.objectStore(store);
      let resultado;
      Promise.resolve(fn(s)).then(r => { resultado = r; }).catch(reject);
      t.oncomplete = () => resolve(resultado);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
    });
  }

  const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  return {
    abrir,
    todos: store => tx(store, 'readonly', s => req2p(s.getAll())),
    obtener: (store, id) => tx(store, 'readonly', s => req2p(s.get(id))),
    guardar: (store, obj) => tx(store, 'readwrite', s => req2p(s.put(obj))),
    borrar: (store, id) => tx(store, 'readwrite', s => req2p(s.delete(id))),
    limpiar: store => tx(store, 'readwrite', s => req2p(s.clear())),
    async getConfig(key, porDefecto) {
      const r = await this.obtener('config', key);
      return r ? r.value : porDefecto;
    },
    setConfig: (key, value) => tx('config', 'readwrite', s => req2p(s.put({ key, value }))),
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  };
})();
