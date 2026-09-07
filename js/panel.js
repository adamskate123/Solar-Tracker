/**
 * Solar panel modelling: what a tilted, oriented surface actually receives.
 *
 * The rest of the app reports global horizontal irradiance - what lands on a
 * flat surface. A panel is neither flat nor pointed at the sun, so its yield
 * needs transposing onto the plane of array (POA), and a real site usually has
 * a ridge, a roof or a tree line cutting off part of the sky. Both are here.
 *
 * Azimuths follow the rest of the app: degrees from north, clockwise, so 180
 * is due south. Tilt is degrees from horizontal. Pure functions throughout.
 */

import { sunPosition, clearSkyIrradiance } from './solar.js';

const RAD = Math.PI / 180;
const SOLAR_CONSTANT = 1361;      // W/m^2, matches solar.js
export const DEFAULT_ALBEDO = 0.2; // ordinary ground; snow is far higher

/**
 * Cosine of the angle between the sun and the panel's normal.
 *
 * cos(AOI) = cos(z)cos(b) + sin(z)sin(b)cos(as - ap), for solar zenith z,
 * tilt b, solar azimuth as and panel azimuth ap. A horizontal panel (b = 0)
 * reduces to cos(z), as it must.
 */
export function cosAOI(sunElevation, sunAzimuth, tilt, panelAzimuth) {
  const z = (90 - sunElevation) * RAD;
  const b = tilt * RAD;
  const d = (sunAzimuth - panelAzimuth) * RAD;
  return Math.cos(z) * Math.cos(b) + Math.sin(z) * Math.sin(b) * Math.cos(d);
}

/* ---------- horizon profile ---------- */

/** Twelve sectors, 30 degrees apart, starting due north. */
export const HORIZON_SECTORS = 12;
export const horizonAzimuths = () =>
  Array.from({ length: HORIZON_SECTORS }, (_, i) => (i * 360) / HORIZON_SECTORS);

/** A flat, unobstructed horizon. */
export const flatHorizon = () => new Array(HORIZON_SECTORS).fill(0);

/** Horizon elevation at any azimuth, interpolated between sectors. */
export function horizonAt(profile, azimuth) {
  if (!profile || !profile.length) return 0;
  const n = profile.length;
  const step = 360 / n;
  const a = ((azimuth % 360) + 360) % 360;
  const i = Math.floor(a / step);
  const t = (a - i * step) / step;
  const lo = profile[i % n] || 0;
  const hi = profile[(i + 1) % n] || 0;
  return lo + (hi - lo) * t;
}

/** True when terrain hides the sun even though it is above the true horizon. */
export function isBlocked(profile, sunElevation, sunAzimuth) {
  return sunElevation < horizonAt(profile, sunAzimuth);
}

/**
 * Sky view factor: the share of the sky dome still visible past the horizon.
 *
 * For an obstruction of elevation h filling a sector, the blocked share of the
 * cosine-weighted hemisphere is sin^2(h), so averaging that around the compass
 * gives the fraction lost. Used to thin the isotropic diffuse, which would
 * otherwise ignore the terrain entirely.
 */
export function skyViewFactor(profile) {
  if (!profile || !profile.length) return 1;
  const blocked = profile.reduce((sum, h) => {
    const e = Math.max(0, Math.min(90, h || 0));
    return sum + Math.sin(e * RAD) ** 2;
  }, 0) / profile.length;
  return 1 - blocked;
}

/* ---------- plane-of-array irradiance ---------- */

/**
 * Irradiance on a tilted plane, by the Hay-Davies transposition.
 *
 * Diffuse is split into a circumsolar part, which follows the beam and so is
 * weighted by the same geometry, and an isotropic remainder spread over the
 * visible sky. The anisotropy index Ai = DNI / E0 decides the split: a clear
 * sky sends most of its diffuse from around the sun, an overcast one does not.
 * Ground reflection closes it out.
 *
 * @returns {{beam:number, sky:number, ground:number, total:number}} W/m^2
 */
export function poaIrradiance({
  dni, dhi, ghi, sunElevation, sunAzimuth, tilt, panelAzimuth,
  albedo = DEFAULT_ALBEDO, horizon = null,
}) {
  const zero = { beam: 0, sky: 0, ground: 0, total: 0 };
  if (sunElevation <= 0) return zero;

  const blocked = horizon ? isBlocked(horizon, sunElevation, sunAzimuth) : false;
  const svf = horizon ? skyViewFactor(horizon) : 1;

  const cosZ = Math.cos((90 - sunElevation) * RAD);
  const cosI = cosAOI(sunElevation, sunAzimuth, tilt, panelAzimuth);
  const b = tilt * RAD;

  // Terrain hides the direct beam entirely; diffuse still arrives.
  const beam = blocked ? 0 : dni * Math.max(0, cosI);

  const ai = Math.max(0, Math.min(1, dni / SOLAR_CONSTANT));
  const rb = cosZ > 0.01 ? Math.max(0, cosI) / cosZ : 0;
  const circumsolar = blocked ? 0 : dhi * ai * rb;
  const isotropic = dhi * (1 - ai) * ((1 + Math.cos(b)) / 2) * svf;
  const sky = circumsolar + isotropic;

  const ground = ghi * albedo * ((1 - Math.cos(b)) / 2);

  return { beam, sky, ground, total: beam + sky + ground };
}

/* ---------- annual yield ---------- */

/**
 * Pre-computed sun positions and clear-sky irradiance across a year.
 *
 * Sampling every few days and every half hour keeps a full tilt/azimuth sweep
 * fast, and the answer barely moves: orientation optimisation is dominated by
 * geometry, which changes smoothly. Each sample carries the hours it stands
 * for, so summing is a straight energy integral.
 */
export function sunSamples(lat, lon, tzOffset, { year = 2026, dayStep = 3, minuteStep = 30 } = {}) {
  const samples = [];
  const hoursPer = (minuteStep / 60) * dayStep;
  for (let doy = 1; doy <= 365; doy += dayStep) {
    const d = new Date(Date.UTC(year, 0, doy));
    const date = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    for (let m = 0; m < 1440; m += minuteStep) {
      const pos = sunPosition(lat, lon, date, m + minuteStep / 2, tzOffset);
      if (pos.apparentElevation <= 0) continue;      // night contributes nothing
      const irr = clearSkyIrradiance(pos.apparentElevation);
      samples.push({
        doy,
        elevation: pos.apparentElevation,
        azimuth: pos.azimuth,
        dni: irr.dni,
        dhi: irr.diffuse,
        ghi: irr.ghi,
        hours: hoursPer,
      });
    }
  }
  return samples;
}

/**
 * Clear-sky energy on a plane over a year, in kWh/m^2.
 * @param {Array} samples from `sunSamples`
 */
export function annualPOA(samples, { tilt, panelAzimuth, albedo = DEFAULT_ALBEDO, horizon = null }) {
  let wh = 0;
  for (const s of samples) {
    const poa = poaIrradiance({
      dni: s.dni, dhi: s.dhi, ghi: s.ghi,
      sunElevation: s.elevation, sunAzimuth: s.azimuth,
      tilt, panelAzimuth, albedo, horizon,
    });
    wh += poa.total * s.hours;
  }
  return wh / 1000;
}

/** Energy over one season's worth of samples, for summer/winter optima. */
export function seasonalPOA(samples, orientation, doyFrom, doyTo) {
  const wrapped = doyFrom > doyTo;
  const slice = samples.filter((s) =>
    wrapped ? (s.doy >= doyFrom || s.doy <= doyTo) : (s.doy >= doyFrom && s.doy <= doyTo));
  return annualPOA(slice, orientation);
}

/**
 * Search tilt and azimuth for the most energy over the given samples.
 *
 * A coarse sweep locates the basin, then a fine sweep around the winner pins
 * it down - the surface is smooth and single-peaked in both axes, so this
 * finds the true optimum far faster than a fine sweep everywhere.
 *
 * @returns {{tilt:number, azimuth:number, annual:number, curve:Array}}
 *   `curve` is yield against tilt at the winning azimuth, for plotting.
 */
export function optimizeOrientation(samples, { albedo = DEFAULT_ALBEDO, horizon = null } = {}) {
  const evaluate = (tilt, panelAzimuth) =>
    annualPOA(samples, { tilt, panelAzimuth, albedo, horizon });

  let best = { tilt: 0, azimuth: 180, annual: -1 };
  for (let az = 0; az < 360; az += 15) {
    for (let tilt = 0; tilt <= 90; tilt += 10) {
      const annual = evaluate(tilt, az);
      if (annual > best.annual) best = { tilt, azimuth: az, annual };
    }
  }
  for (let az = best.azimuth - 12; az <= best.azimuth + 12; az += 3) {
    for (let tilt = Math.max(0, best.tilt - 9); tilt <= Math.min(90, best.tilt + 9); tilt += 1.5) {
      const annual = evaluate(tilt, ((az % 360) + 360) % 360);
      if (annual > best.annual) {
        best = { tilt, azimuth: ((az % 360) + 360) % 360, annual };
      }
    }
  }

  const curve = [];
  for (let tilt = 0; tilt <= 90; tilt += 5) {
    curve.push({ x: tilt, y: evaluate(tilt, best.azimuth) });
  }
  return { ...best, curve };
}
