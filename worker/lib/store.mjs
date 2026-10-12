// Storage abstraction: Store {get,set,del} (JSON values).
// Auto-select: KVStore when the SEVEND_KV binding exists, otherwise FileStore
// (JSON files with atomic tmp+rename writes) for the express/dev target.
// This module is statically free of node: imports so the worker bundle stays
// clean — FileStore loads node:fs lazily via dynamic import, only when used.

export class KVStore {
    constructor(kv) { this.kv = kv; }
    async get(key) {
        const raw = await this.kv.get(key);
        if (raw == null) return null;
        try { return JSON.parse(raw); } catch { return null; }
    }
    async set(key, value) {
        await this.kv.put(key, JSON.stringify(value));
    }
    async del(key) {
        await this.kv.delete(key);
    }
}

let _fs = null;
async function nodeFs() {
    if (!_fs) _fs = await import('node:fs');
    return _fs;
}

const safeKey = (key) => String(key).replace(/[^A-Za-z0-9_.-]/g, '_');

export class FileStore {
    constructor(baseDir) { this.baseDir = baseDir; }
    _path(key) { return `${this.baseDir}/${safeKey(key)}.json`; }
    async _ensure() {
        const fs = await nodeFs();
        fs.mkdirSync(this.baseDir, { recursive: true });
    }
    async get(key) {
        const fs = await nodeFs();
        try {
            return JSON.parse(fs.readFileSync(this._path(key), 'utf8'));
        } catch { return null; }
    }
    async set(key, value) {
        const fs = await nodeFs();
        await this._ensure();
        const tmp = this._path(key) + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(value));
        fs.renameSync(tmp, this._path(key));
    }
    async del(key) {
        const fs = await nodeFs();
        try { fs.unlinkSync(this._path(key)); } catch { /* already gone */ }
    }
}

function defaultFileDir(env) {
    if (env?.STORE_DIR) return env.STORE_DIR;
    try {
        if (typeof process !== 'undefined' && process.env?.STORE_DIR) return process.env.STORE_DIR;
    } catch { /* non-node runtime */ }
    return './data-store';
}

// env: worker env object (may carry SEVEND_KV and STORE_DIR); on node,
// process.env.STORE_DIR is honored as well.
export function makeStore(env = {}) {
    if (env?.SEVEND_KV) return new KVStore(env.SEVEND_KV);
    return new FileStore(defaultFileDir(env));
}
