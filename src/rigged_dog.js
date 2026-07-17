import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { COATS, NECKS } from './cosmetics.js';


export const REQUIRED_CLIPS = [
  'idle', 'walk', 'trot', 'gallop', 'takeoff', 'jump', 'landing',
  'slide', 'tunnel', 'sit', 'weave', 'balance', 'stumble', 'dead',
];

const MODE_CLIP = {
  idle: 'idle',
  walk: 'walk',
  trot: 'trot',
  run: 'gallop',
  takeoff: 'takeoff',
  jump: 'jump',
  landing: 'landing',
  slide: 'slide',
  tunnel: 'tunnel',
  sit: 'sit',
  weave: 'weave',
  balance: 'balance',
  stumble: 'stumble',
  dead: 'dead',
  fly: 'jump',
  launched: 'jump',
};

const PHASE_SCRUBBED = new Set(['walk', 'trot', 'gallop', 'tunnel']);
const PROGRESS_SCRUBBED = new Map([
  ['takeoff', 'takeoffT'],
  ['jump', 'jumpT'],
  ['landing', 'landingT'],
  ['stumble', 'stumbleT'],
]);
const ONE_SHOT = new Set(['takeoff', 'landing', 'sit', 'stumble', 'dead']);

function hexRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function shade(rgb, factor) {
  return rgb.map(value => Math.max(0, Math.min(255, Math.round(value * factor))));
}

function pixelNoise(x, y) {
  let value = Math.imul(x + 0x9e37, 374761393) ^ Math.imul(y + 0x85eb, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function textureSignature(data) {
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 16) {
    hash ^= data[i];
    hash = Math.imul(hash, 16777619);
    hash ^= data[i + 1] || 0;
    hash = Math.imul(hash, 16777619);
    hash ^= data[i + 2] || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function copyTextureSettings(source, target) {
  target.name = `${source.name || 'BorderCollie'}_cosmetic`;
  target.colorSpace = source.colorSpace;
  target.flipY = source.flipY;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.anisotropy = source.anisotropy;
  target.channel = source.channel;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.matrix.copy(source.matrix);
  target.needsUpdate = true;
  return target;
}

function cosmeticTexture(source, coat) {
  if (!coat) return { texture: source?.clone() || null, signature: 'base' };
  const image = source?.image;
  if (!image || typeof document === 'undefined') {
    return { texture: source?.clone() || null, signature: coat ? `coat:${coat.name}` : 'base' };
  }
  const width = image.width || image.videoWidth;
  const height = image.height || image.videoHeight;
  if (!width || !height) return { texture: source.clone(), signature: 'base' };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);

  const body = hexRgb(coat.body);
  const white = hexRgb(coat.white);
  const accent = hexRgb(coat.accent ?? coat.body);
  const patch = hexRgb(coat.patch ?? coat.body);
  const data = pixels.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const luminance = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
      const chroma = max - min;

      // В исходной текстуре рыжие участки соответствуют подпалинам; холодные
      // голубые полутона — теням на белой шерсти.
      const isTan = chroma > 22 && r > b * 1.18 && r > g * 1.02;
      const isWhite = luminance > 0.48 || (b > r * 1.12 && luminance > 0.22);
      let color;
      if (isTan) {
        color = accent;
      } else if (isWhite) {
        color = white;
      } else if (coat.merle) {
        const broad = pixelNoise(Math.floor(x / 18), Math.floor(y / 18));
        const fine = pixelNoise(Math.floor(x / 5), Math.floor(y / 5));
        color = broad > 0.53 || (broad > 0.38 && fine > 0.72) ? patch : body;
      } else {
        color = body;
      }

      const variation = isWhite
        ? 0.76 + Math.min(0.24, luminance * 0.28)
        : 0.76 + luminance * 0.34 + (pixelNoise(x, y) - 0.5) * 0.035;
      const shaded = shade(color, variation);
      data[i] = shaded[0];
      data[i + 1] = shaded[1];
      data[i + 2] = shaded[2];
    }
  }
  context.putImageData(pixels, 0, 0);

  return {
    texture: copyTextureSettings(source, new THREE.CanvasTexture(canvas)),
    signature: textureSignature(pixels.data),
  };
}

function cloneMaterial(material, coat, textureCache, cosmeticState) {
  if (Array.isArray(material)) {
    return material.map(item => cloneMaterial(item, coat, textureCache, cosmeticState));
  }
  const copy = material.clone();
  if (material.map) {
    if (!textureCache.has(material.map)) {
      textureCache.set(material.map, cosmeticTexture(material.map, coat));
    }
    const result = textureCache.get(material.map);
    copy.map = result.texture;
    cosmeticState.textureSignature = result.signature;
  }
  copy.flatShading = true;
  copy.roughness = 0.9;
  copy.metalness = 0;
  copy.needsUpdate = true;
  return copy;
}

function bandanaMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.88,
    metalness: 0,
    flatShading: true,
    side: THREE.DoubleSide,
  });
}

function addBandana(model, neckItem) {
  if (!neckItem) return null;
  const neckBone = model.getObjectByName('neck');
  if (!neckBone?.isBone) return null;

  const bandana = new THREE.Group();
  bandana.name = 'RiggedBandana';
  // Кость начинается глубоко в плечевом объёме; сдвигаем аксессуар к середине
  // шеи, чтобы он не тонул в шерсти при галопе и тоннельной позе.
  bandana.position.set(0, 0.105, 0);

  const cloth = bandanaMaterial(neckItem.color);
  const trim = neckItem.tip != null ? bandanaMaterial(neckItem.tip) : cloth;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.026, 6, 16), cloth);
  ring.name = 'RiggedBandanaRing';
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(1.0, 1.0, 0.78);
  ring.castShadow = true;
  bandana.add(ring);

  const flap = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.20, 3), cloth);
  flap.name = 'RiggedBandanaFlap';
  // Отрицательная локальная Z — видимая сторона для основной боковой камеры.
  flap.position.set(0, -0.12, -0.13);
  flap.rotation.x = 0.36;
  flap.scale.z = 0.18;
  flap.castShadow = true;
  bandana.add(flap);

  if (neckItem.tip != null) {
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.038, 0), trim);
    tip.name = 'RiggedBandanaTip';
    tip.position.set(0, -0.025, -0.13);
    tip.castShadow = true;
    bandana.add(tip);
  }
  neckBone.add(bandana);
  return bandana;
}

function disposeMaterial(material) {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    if (!item) continue;
    for (const value of Object.values(item)) {
      if (value?.isTexture) value.dispose();
    }
    item.dispose();
  }
}

export class RiggedDog {
  constructor(templateScene, clips, breedKey = 'border', equip = {}) {
    this.root = new THREE.Group();
    this.model = cloneSkeleton(templateScene);
    this.root.add(this.model);
    this.breedKey = breedKey;
    this.equip = { ...(equip || {}) };
    this.cfg = { stride: 2.6, scale: 1 };
    this.isRiggedDog = true;
    this.clipNames = clips.map(clip => clip.name).sort();
    this.skinnedMeshes = 0;
    this.mode = null;
    this.modeTime = 0;
    this.currentAction = null;
    this.cosmeticState = {
      breed: breedKey,
      coat: this.equip.coat || null,
      neck: this.equip.neck || null,
      textureSignature: null,
      bandanaBone: null,
    };

    const coat = this.equip.coat ? COATS[this.equip.coat] : null;
    const textureCache = new Map();

    this.model.traverse(object => {
      if (!object.isMesh) return;
      object.geometry = object.geometry.clone();
      object.material = cloneMaterial(object.material, coat, textureCache, this.cosmeticState);
      object.castShadow = true;
      object.receiveShadow = true;
      if (object.isSkinnedMesh) this.skinnedMeshes++;
    });
    const neckItem = this.equip.neck ? NECKS[this.equip.neck] : null;
    const bandana = addBandana(this.model, neckItem);
    this.bandana = bandana;
    this.cosmeticState.bandanaBone = bandana?.parent?.name || null;

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.clampWhenFinished = ONE_SHOT.has(clip.name);
      action.setLoop(ONE_SHOT.has(clip.name) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      this.actions.set(clip.name, action);
    }
    this._switchMode('idle');
    this.mixer.update(0);
    this.groundSupport = this._readGroundSupport();
  }

  _readGroundSupport() {
    // glTF удаляет точки из имён костей (`front_toe.L` -> `front_toeL`), поэтому
    // принимаем обе формы. Z берём из семантических toe-bones, а не из габарита
    // морда–хвост: это реальная опорная база rig без подобранных magic offsets.
    const localZ = names => {
      const bone = names.map(name => this.model.getObjectByName(name)).find(Boolean);
      if (!bone) return null;
      this.model.updateWorldMatrix(true, true);
      const inverse = this.model.matrixWorld.clone().invert();
      return bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).z;
    };
    const front = [
      localZ(['front_toeL', 'front_toe.L']),
      localZ(['front_toeR', 'front_toe.R']),
    ].filter(Number.isFinite);
    const rear = [
      localZ(['rear_toeL', 'rear_toe.L']),
      localZ(['rear_toeR', 'rear_toe.R']),
    ].filter(Number.isFinite);
    if (front.length !== 2 || rear.length !== 2) return null;
    return {
      frontZ: front.reduce((sum, value) => sum + value, 0) / front.length,
      rearZ: rear.reduce((sum, value) => sum + value, 0) / rear.length,
    };
  }

  resetForRun() {
    this.mixer.stopAllAction();
    for (const action of this.actions.values()) {
      action.stop();
      action.reset();
      action.enabled = true;
      action.paused = false;
      action.setEffectiveTimeScale(1);
      action.setEffectiveWeight(1);
    }
    this.mixer.setTime(0);
    this.currentAction = null;
    this.mode = null;
    this.modeTime = 0;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.scale.set(1, 1, 1);
    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    this.model.scale.set(1, 1, 1);
    this._switchMode('idle');
    this.mixer.update(0);
  }

  _switchMode(mode) {
    const clipName = MODE_CLIP[mode] || 'gallop';
    const next = this.actions.get(clipName);
    if (!next || next === this.currentAction) {
      this.mode = mode;
      return;
    }
    const previous = this.currentAction;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (previous) previous.crossFadeTo(next, 0.08, false);
    this.currentAction = next;
    this.mode = mode;
    this.modeTime = 0;
  }

  update(dt, pose = {}) {
    const mode = pose.mode || 'run';
    // Surface pitch применяется ко всему персонажу; animation pitch остаётся локальным
    // для прыжка/подброса и не удваивает наклон поверхности.
    this.root.rotation.x = pose.surfacePitch || 0;
    if (mode !== this.mode) this._switchMode(mode);
    this.modeTime += dt;
    this.mixer.update(dt);

    const clipName = MODE_CLIP[mode] || 'gallop';
    const action = this.actions.get(clipName);
    if (action && (PHASE_SCRUBBED.has(clipName) || PROGRESS_SCRUBBED.has(clipName))) {
      const duration = Math.max(0.001, action.getClip().duration);
      if (PHASE_SCRUBBED.has(clipName)) {
        const phase = Number.isFinite(pose.phase) ? pose.phase : 0;
        action.time = THREE.MathUtils.euclideanModulo(phase, Math.PI * 2) / (Math.PI * 2) * duration;
      } else if (mode === 'fly' || mode === 'launched') {
        action.time = duration * 0.5;
      } else {
        const progressKey = PROGRESS_SCRUBBED.get(clipName);
        action.time = THREE.MathUtils.clamp(pose[progressKey] || 0, 0, 1) * duration;
      }
      this.mixer.update(0);
    }

    const lean = pose.lean || 0;
    const weave = mode === 'weave' ? (pose.weaveLean || 0) : 0;
    const balance = mode === 'balance' ? (pose.balance || 0) : 0;
    // Минус у balance: rotation.z>0 визуально валит ВЛЕВО, а balance>0 = падение ВПРАВО
    this.model.rotation.z = lean + weave * 0.85 - balance * 0.65;
    this.model.rotation.y = (lean + weave) * 0.28;
    const animationPitch = (mode === 'jump' || mode === 'takeoff')
      ? THREE.MathUtils.clamp(-(pose.vy || 0) * 0.035, -0.28, 0.34)
      : (mode === 'launched' ? (pose.spin || 0) : 0);
    this.model.rotation.x = animationPitch;

    const land = THREE.MathUtils.clamp((pose.landT || 0) / 0.18, 0, 1);
    this.model.scale.set(1 + land * 0.06, 1 - land * 0.14, 1 + land * 0.08);
  }

  debugState() {
    const round = value => +value.toFixed(5);
    return {
      mode: this.mode,
      action: this.currentAction?.getClip().name || null,
      time: round(this.currentAction?.time || 0),
      rotation: this.model.rotation.toArray().slice(0, 3).map(round),
      scale: this.model.scale.toArray().map(round),
    };
  }

  debugCosmetics() {
    const state = { ...this.cosmeticState };
    if (this.bandana) {
      this.bandana.updateWorldMatrix(true, true);
      const position = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      this.bandana.matrixWorld.decompose(position, rotation, scale);
      const box = new THREE.Box3().setFromObject(this.bandana);
      state.bandanaPosition = position.toArray().map(value => +value.toFixed(4));
      state.bandanaScale = scale.toArray().map(value => +value.toFixed(4));
      state.bandanaSize = box.getSize(new THREE.Vector3()).toArray().map(value => +value.toFixed(4));
      state.bandanaParts = this.bandana.children.map(part => ({
        name: part.name,
        position: part.getWorldPosition(new THREE.Vector3()).toArray().map(value => +value.toFixed(4)),
        size: new THREE.Box3().setFromObject(part).getSize(new THREE.Vector3())
          .toArray().map(value => +value.toFixed(4)),
      }));
    }
    return state;
  }

  earImpulse() {}

  tailImpulse() {}

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.model.traverse(object => {
      if (!object.isMesh) return;
      object.geometry?.dispose();
      disposeMaterial(object.material);
    });
  }
}

export async function loadRiggedDogFactory(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const clipsByName = new Map(gltf.animations.map(clip => [clip.name, clip]));
  const missing = REQUIRED_CLIPS.filter(name => !clipsByName.has(name));
  if (missing.length) throw new Error(`GLB: отсутствуют clips: ${missing.join(', ')}`);

  let skinnedMeshes = 0;
  gltf.scene.traverse(object => { if (object.isSkinnedMesh) skinnedMeshes++; });
  if (skinnedMeshes !== 1) {
    throw new Error(`GLB: ожидалась 1 SkinnedMesh, найдено ${skinnedMeshes}`);
  }

  const clips = REQUIRED_CLIPS.map(name => clipsByName.get(name));
  return (breedKey, equip) => new RiggedDog(gltf.scene, clips, breedKey, equip);
}
