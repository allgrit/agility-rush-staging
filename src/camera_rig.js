import * as THREE from 'three';

// Камера «живёт»: пружинное слежение, дыхание, опережение в поворотах,
// crouch-режим у тоннеля, полётный режим на фрисби, вертикальный dip на приземлении,
// roll-пульс на вехах комбо, FOV-кик от скорости, шейк, орбита смерти.

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 2.6, 6);
    this.vel = new THREE.Vector3();
    this.lookAt = new THREE.Vector3(0, 0.8, 0);
    this.shakeAmp = 0;
    this.shakeT = 0;
    this.baseFov = 62;
    this.fovKick = 0;
    this.rollTarget = 0;
    this.roll = 0;
    this.zoomPunch = 0;
    this.orbit = 0; // режим облёта при смерти
    this.orbitAngle = 0;
    this.time = 0;
    this.dipY = 0; this.dipV = 0; // вертикальная пружина (приземление)
    this.rollPulseT = 0;
    this.crouch = 0; // сглаженный crouch-фактор (тоннель/подкат)
    this.flyK = 0;   // сглаженный полётный фактор
    this._tgt = new THREE.Vector3();  // scratch для target/lookTarget — без new Vector3 каждый кадр
    this._look = new THREE.Vector3();
  }

  shake(amp) { this.shakeAmp = Math.max(this.shakeAmp, amp); }
  punch(v = 1) { this.zoomPunch = Math.max(this.zoomPunch, v); }
  dip(v = 1) { this.dipV -= 1.6 * v; }
  rollPulse() { this.rollPulseT = 0.6; }
  startOrbit() { this.orbit = 1; this.orbitAngle = 0; }
  reset() {
    this.pos.set(0, 2.6, 6);
    this.vel.set(0, 0, 0);
    this.lookAt.set(0, 0.8, 0);
    this.shakeAmp = 0;
    this.shakeT = 0;
    this.fovKick = 0;
    this.rollTarget = 0;
    this.roll = 0;
    this.zoomPunch = 0;
    this.orbit = 0;
    this.orbitAngle = 0;
    this.time = 0;
    this.dipY = 0;
    this.dipV = 0;
    this.rollPulseT = 0;
    this.crouch = 0;
    this.flyK = 0;
    this.elevK = 0;
    this.camera.position.copy(this.pos);
    this.camera.fov = this.baseFov;
    this.camera.lookAt(this.lookAt);
    this.camera.updateProjectionMatrix();
  }

  update(dt, dog, speed, lean, opts = {}) {
    this.shakeT += dt * 24;
    this.time += dt;

    if (this.orbit > 0) {
      // Медленный облёт вокруг собаки после смерти
      this.orbitAngle += dt * 0.7;
      const r = 3.4;
      const target = this._tgt.set(
        dog.x + Math.sin(this.orbitAngle + 0.6) * r,
        1.6 + Math.sin(this.orbitAngle * 0.5) * 0.3,
        dog.z + Math.cos(this.orbitAngle + 0.6) * r
      );
      this.pos.lerp(target, 1 - Math.pow(0.02, dt));
      this.lookAt.lerp(this._look.set(dog.x, 0.5, dog.z), 1 - Math.pow(0.001, dt));
      this.camera.position.copy(this.pos);
      this.camera.lookAt(this.lookAt);
      this.camera.fov += (58 - this.camera.fov) * dt * 2;
      this.camera.updateProjectionMatrix();
      return;
    }

    const spd = Math.min(1, speed / 26);

    // Плавные режимные факторы
    const crouchT = opts.crouch ? 1 : 0;
    this.crouch += (crouchT - this.crouch) * Math.min(1, 6 * dt);
    const flyT = opts.fly ? 1 : 0;
    this.flyK += (flyT - this.flyK) * Math.min(1, 3.5 * dt);
    const elevT = opts.elevated ? 1 : 0;
    this.elevK = (this.elevK || 0) + (elevT - (this.elevK || 0)) * Math.min(1, 4 * dt);

    // Целевая позиция: позади и выше собаки; у тоннеля приседает, в полёте отъезжает
    let back = 3.7 - spd * 0.35;
    // Композиция (feel-редизайн): камера выше — горизонт поднимается (~29% от верха),
    // собака опускается в нижнюю треть (лапы ~74%), под ней больше «пола, летящего под ноги».
    let height = 2.2 + dog.y * 0.8;
    back += this.crouch * -0.6 + this.flyK * 1.1 + this.elevK * 0.5;
    height += this.crouch * -0.75 + this.flyK * 0.7 + this.elevK * 0.35;
    height = Math.max(0.95, height);
    const target = this._tgt.set(dog.x * 0.72, height, dog.z + back);

    // Критически демпфированная пружина
    const stiff = 7.5;
    this.pos.x += (target.x - this.pos.x) * Math.min(1, stiff * dt);
    this.pos.y += (target.y - this.pos.y) * Math.min(1, stiff * 0.85 * dt);
    this.pos.z += (target.z - this.pos.z) * Math.min(1, 12 * dt);

    // Вертикальный dip (приземление) — пружина
    this.dipV += (-this.dipY * 60 - this.dipV * 10) * dt;
    this.dipY += this.dipV * dt;

    // Дыхание камеры: медленный органичный дрейф
    const bx = (Math.sin(this.time * 0.53) + Math.sin(this.time * 1.31)) * 0.018;
    const by = (Math.sin(this.time * 0.71 + 2) + Math.sin(this.time * 1.7)) * 0.012;

    // Боб в такт галопа
    const bob = Math.sin(dog.gallopPhase || 0) * 0.03 * spd;

    // Шейк: события + микро-тряска на высокой скорости
    let sx = 0, sy = 0;
    const speedShake = spd > 0.7 ? (spd - 0.7) * 0.075 : 0; // тряска раньше и сильнее — «на пределе»
    const amp = Math.max(this.shakeAmp, speedShake);
    if (amp > 0.001) {
      sx = (Math.sin(this.shakeT * 1.3) + Math.sin(this.shakeT * 2.7)) * 0.5 * amp;
      sy = (Math.sin(this.shakeT * 1.7 + 1) + Math.sin(this.shakeT * 3.1)) * 0.5 * amp;
      this.shakeAmp *= Math.pow(0.05, dt);
    }

    this.camera.position.set(this.pos.x + sx + bx, this.pos.y + bob + sy + by + this.dipY, this.pos.z);

    // Взгляд: вперёд по трассе, с опережением в сторону манёвра
    const lookTarget = this._look.set(dog.x * 0.8 + lean * 1.1, 0.55 + dog.y * 0.7 - this.crouch * 0.25 - this.elevK * 0.4, dog.z - 3.6 - this.flyK * 2);
    this.lookAt.lerp(lookTarget, 1 - Math.pow(0.0001, dt));
    this.camera.lookAt(this.lookAt);

    // Крен: смена полосы + пульс на вехе комбо
    this.rollTarget = -lean * 0.07;
    if (this.rollPulseT > 0) {
      this.rollPulseT -= dt;
      this.rollTarget += Math.sin(this.rollPulseT * 21) * this.rollPulseT * 0.12;
    }
    this.roll += (this.rollTarget - this.roll) * Math.min(1, 8 * dt);
    this.camera.rotation.z += this.roll;

    // FOV: скорость (квадратично 62→76: рывок «врывается» к концу разгона) + панч + полёт.
    // Асимметричный lerp: вверх быстро (kick), вниз плавно — прежние +9° линейно были ниже
    // порога восприятия.
    if (this.zoomPunch > 0.001) this.zoomPunch *= Math.pow(0.01, dt);
    const targetFov = this.baseFov + spd * spd * 14 - this.zoomPunch * 6 + this.flyK * 7;
    const fovRate = targetFov > this.camera.fov ? 10 : 3;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, fovRate * dt);
    this.camera.updateProjectionMatrix();
  }

  rebase(dz) {
    this.pos.z += dz;
    this.lookAt.z += dz;
    this.camera.position.z += dz;
  }
}
