import * as THREE from 'three';

// Запекание статичной геометрии в merged-меши с vertex colors — главный инструмент
// сокращения draw calls (перф-аудит: у игрока CPU-bound на диспатче ~600 calls).
// Визуально 1:1: цвет материала переезжает в vertex colors при белом материале,
// flat-вид достигается пофейсовыми нормалями non-indexed геометрии.

export function bakeColored(geo, mtx, hex, faceted) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (mtx) g.applyMatrix4(mtx);
  if (faceted) g.computeVertexNormals();
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

export function mergeColored(parts) {
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return m;
}

// Слить все СТАТИЧНЫЕ Mesh-потомки группы в 1-2 меша (бакеты по профилю шейдинга
// и теней). exclude: анимируемые объекты/мутируемые материалы — не трогаются.
// collapse: всё в ОДИН бакет (усреднённый roughness, всё фейсово) — для мелких
// удалённых объектов, где профиль не читается (палатки).
export function bakeStatic(g, exclude = [], { collapse = false } = {}) {
  const excl = new Set();
  for (const e of exclude) if (e) e.traverse((o) => excl.add(o));
  const relOf = (o) => {
    o.updateMatrix();
    const m = o.matrix.clone();
    let p = o.parent;
    while (p && p !== g) { p.updateMatrix(); m.premultiply(p.matrix); p = p.parent; }
    return m;
  };
  const buckets = new Map();
  const victims = [];
  g.traverse((o) => {
    if (!o.isMesh || excl.has(o)) return;
    const m = o.material;
    if (!m || !m.isMeshStandardMaterial || m.map || m.transparent) return;
    victims.push(o);
  });
  if (victims.length < 3) return;
  let rSum = 0;
  for (const o of victims) {
    const m = o.material;
    rSum += m.roughness;
    const key = collapse ? 'all' : [m.flatShading ? 1 : 0, m.roughness.toFixed(2), m.metalness.toFixed(2),
      m.emissive.getHex(), o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0].join('|');
    let b = buckets.get(key);
    if (!b) { b = { parts: [], mat: m, cast: o.castShadow, recv: o.receiveShadow }; buckets.set(key, b); }
    b.cast = b.cast || o.castShadow;
    b.recv = b.recv || o.receiveShadow;
    b.parts.push(bakeColored(o.geometry, relOf(o), m.color.getHex(), collapse ? true : m.flatShading));
  }
  for (const o of victims) o.parent.remove(o);
  for (const b of buckets.values()) {
    const mesh = new THREE.Mesh(mergeColored(b.parts), new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: collapse ? rSum / victims.length : b.mat.roughness,
      metalness: b.mat.metalness,
      emissive: b.mat.emissive.getHex(),
    }));
    mesh.castShadow = b.cast; mesh.receiveShadow = b.recv;
    g.add(mesh);
  }
}
