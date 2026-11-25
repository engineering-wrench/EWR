/**
 * index.js — установка реализаций устройств P1.4 в таблицу `DEVICES`.
 *
 * `DEVICES` создаётся в `ckt.js` из каталога (`catalog.js`). Порт устройства
 * добавляет свои хуки (`DEVsetup`, `DEVload`, …). Чтобы не плодить импорты в
 * `ckt.js`, все реализации собраны здесь и навешиваются по имени устройства.
 *
 * Устройства, которых ещё нет в порте, остаются с `null`-хуками — это
 * ожидаемо до P2/P3.
 */

import { resistor } from './resistor.js';
import { capacitor } from './capacitor.js';
import { inductor, mutual } from './inductor.js';
import { vsource } from './vsource.js';
import { isource } from './isource.js';
import { sw, csw } from './switch.js';
import { diode } from './diode.js';
import { bjt } from './bjt.js';

/** Имя устройства в каталоге → набор хуков. */
export const DEVICE_IMPLS = {
  Resistor: resistor,
  Capacitor: capacitor,
  Inductor: inductor,
  mutual,
  Vsource: vsource,
  Isource: isource,
  Switch: sw,
  CSwitch: csw,
  Diode: diode,
  BJT: bjt,
};

/**
 * Навесить реализации на `DEVICES`.
 *
 * @param {object[]} devices — `DEVICES` из `ckt.js`
 * @returns {number} число установленных устройств
 */
export function installDevices(devices) {
  let installed = 0;
  for (const dev of devices) {
    const impl = DEVICE_IMPLS[dev.name];
    if (!impl) continue;
    for (const [hook, fn] of Object.entries(impl)) {
      if (fn) dev[hook] = fn;
    }
    installed++;
  }
  return installed;
}
