import {integer,finite} from '../learning/contracts.js';

/** SQLite WAL evidence store, scoped by server/world/version/dimension, never an x-ray source. */
export async function openWorldStore({path,worldId,serverId,minecraftVersion,clock=Date.now}={}) {
  for(const [name,value] of Object.entries({path,worldId,serverId,minecraftVersion}))if(typeof value!=='string'||!value.trim()||value.length>4096)throw new Error(`${name} is required`);
  let DatabaseSync;try{({DatabaseSync}=await import('node:sqlite'));}catch{throw new Error('World store needs Node.js 22.13+ or 24+ with node:sqlite');}
  const db=new DatabaseSync(path);let closed=false;
  try{
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blocks(dimension TEXT NOT NULL,x INTEGER NOT NULL,y INTEGER NOT NULL,z INTEGER NOT NULL,name TEXT NOT NULL,seen INTEGER NOT NULL,agent TEXT NOT NULL,PRIMARY KEY(dimension,x,y,z)); CREATE INDEX IF NOT EXISTS blocks_names ON blocks(dimension,name,x,z);');
    const expected=JSON.stringify({schemaVersion:1,worldId,serverId,minecraftVersion}),meta=db.prepare('SELECT value FROM metadata WHERE key=?').get('identity');if(meta&&meta.value!==expected)throw new Error('World store identity differs: use another database for this world/server/version');if(!meta)db.prepare('INSERT INTO metadata VALUES(?,?)').run('identity',expected);
  }catch(e){db.close();throw e;}
  const validDimension=d=>{if(typeof d!=='string'||!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(d))throw new Error('Namespaced dimension required');};
  const pos=p=>{for(const v of [p?.x,p?.y,p?.z])integer(v,-30000000,30000000,'block coordinate');};
  const open=()=>{if(closed)throw new Error('World store closed');};
  const upsert=db.prepare('INSERT INTO blocks VALUES(?,?,?,?,?,?,?) ON CONFLICT(dimension,x,y,z) DO UPDATE SET name=excluded.name,seen=excluded.seen,agent=excluded.agent WHERE excluded.seen>=blocks.seen');
  return {
    observe({dimension,blocks,agent='unknown',observedAt=clock()}){open();validDimension(dimension);integer(observedAt,0,Number.MAX_SAFE_INTEGER,'observedAt');if(typeof agent!=='string'||agent.length>128||!Array.isArray(blocks)||blocks.length>4096)throw new Error('World observation batch exceeds budget');for(const b of blocks){pos(b.position);if(typeof b.name!=='string'||!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(b.name))throw new Error('Namespaced block name required');}
      db.exec('BEGIN IMMEDIATE');try{for(const b of blocks){const {x,y,z}=b.position;upsert.run(dimension,x,y,z,b.name,observedAt,agent);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return blocks.length;
    },
    query({dimension,names=[],near,radius=192,maxAgeMs=86400000,limit=256}={}){open();validDimension(dimension);pos(near);integer(limit,1,4096,'limit');finite(radius,0,4096,'radius');finite(maxAgeMs,0,Number.MAX_SAFE_INTEGER,'maxAgeMs');if(!Array.isArray(names)||names.length>256||names.some(n=>typeof n!=='string'))throw new Error('Block name filter');const where=names.length?` AND name IN (${names.map(()=>'?').join(',')})`:'';
      const rows=db.prepare(`SELECT * FROM blocks WHERE dimension=? AND name NOT IN ('minecraft:air','minecraft:cave_air','minecraft:void_air') AND x BETWEEN ? AND ? AND y BETWEEN ? AND ? AND z BETWEEN ? AND ? AND seen>=?${where} AND ((x-?)*(x-?)+(y-?)*(y-?)+(z-?)*(z-?))<=? ORDER BY ((x-?)*(x-?)+(y-?)*(y-?)+(z-?)*(z-?)) LIMIT ?`).all(dimension,near.x-radius,near.x+radius,near.y-radius,near.y+radius,near.z-radius,near.z+radius,clock()-maxAgeMs,...names,near.x,near.x,near.y,near.y,near.z,near.z,radius*radius,near.x,near.x,near.y,near.y,near.z,near.z,limit);
      return rows.map(r=>({name:r.name,position:{x:r.x,y:r.y,z:r.z},dimension:r.dimension,lastSeen:r.seen,agent:r.agent,requiresRevalidation:true}));
    },
    prune({before=clock()-86400000}={}){open();integer(before,0,Number.MAX_SAFE_INTEGER,'before');return db.prepare('DELETE FROM blocks WHERE seen<?').run(before).changes;},
    close(){if(!closed){closed=true;db.close();}}
  };
}
