/**
 * Solar position calculations based on the NOAA Solar Calculator equations
 * (Meeus, "Astronomical Algorithms"). Accurate to roughly 0.01 degrees for
 * years 1900-2100, which is far tighter than anything visible on a chart.
 *
 * All angles in/out of the public API are degrees; times are minutes after
 * local midnight unless noted. Pure functions only - this module runs in the
 * browser and under node for tests.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Julian Day for a calendar date at 0h UTC (Gregorian). */
export function julianDay(year, month, day) {
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day + b - 1524.5
  );
}

/** Julian centuries since J2000.0 for a JD (including fractional day). */
function julianCentury(jd) {
  return (jd - 2451545) / 36525;
}

/**
 * Core solar geometry for one instant.
 * @param {number} jd Julian Day including the fractional (UTC) day.
 * @returns {{declination:number, eqOfTimeMin:number, apparentLong:number,
 *            trueAnomaly:number, radiusAU:number, obliquity:number}}
 *   declination and angles in degrees, equation of time in minutes,
 *   sun-Earth distance in AU.
 */
export function solarGeometry(jd) {
  const t = julianCentury(jd);

  const meanLong = ((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360 + 360) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const eqOfCenter =
    Math.sin(meanAnom * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnom * RAD) * 0.000289;

  const trueLong = meanLong + eqOfCenter;
  const trueAnomaly = meanAnom + eqOfCenter;
  // Sun-Earth distance (AU), Meeus 25.5 — the orbit is very nearly circular.
  const radiusAU = (1.000001018 * (1 - eccent * eccent)) / (1 + eccent * Math.cos(trueAnomaly * RAD));
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliq =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);

  const declination =
    Math.asin(Math.sin(obliq * RAD) * Math.sin(apparentLong * RAD)) * DEG;

  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqOfTimeMin =
    4 * DEG * (
      y * Math.sin(2 * meanLong * RAD) -
      2 * eccent * Math.sin(meanAnom * RAD) +
      4 * eccent * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD) -
      0.5 * y * y * Math.sin(4 * meanLong * RAD) -
      1.25 * eccent * eccent * Math.sin(2 * meanAnom * RAD)
    );

  return { declination, eqOfTimeMin, apparentLong, trueAnomaly, radiusAU, obliquity: obliq };
}

/** Atmospheric refraction correction (degrees) for a true elevation (degrees). NOAA piecewise fit. */
export function refractionCorrection(elev) {
  if (elev > 85) return 0;
  const te = Math.tan(elev * RAD);
  let corr;
  if (elev > 5) {
    corr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  } else if (elev > -0.575) {
    corr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
  } else {
    corr = -20.774 / te;
  }
  return corr / 3600;
}

/**
 * Sun position for a location and local time.
 * @param {number} lat Latitude, degrees (+N).
 * @param {number} lon Longitude, degrees (+E).
 * @param {{year:number, month:number, day:number}} date Local calendar date.
 * @param {number} minutes Minutes after local midnight.
 * @param {number} tzOffset Hours ahead of UTC for that local time.
 * @returns {{elevation:number, apparentElevation:number, azimuth:number,
 *            declination:number, eqOfTimeMin:number, hourAngle:number}}
 */
export function sunPosition(lat, lon, date, minutes, tzOffset) {
  const jd = julianDay(date.year, date.month, date.day) + (minutes / 60 - tzOffset) / 24;
  const { declination, eqOfTimeMin } = solarGeometry(jd);

  let trueSolarTime = (minutes + eqOfTimeMin + 4 * lon - 60 * tzOffset) % 1440;
  if (trueSolarTime < 0) trueSolarTime += 1440;
  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const cosZenith =
    Math.sin(lat * RAD) * Math.sin(declination * RAD) +
    Math.cos(lat * RAD) * Math.cos(declination * RAD) * Math.cos(hourAngle * RAD);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEG;
  const elevation = 90 - zenith;

  let azimuth;
  const denom = Math.cos(lat * RAD) * Math.sin(zenith * RAD);
  if (Math.abs(denom) > 1e-9) {
    let azArg =
      (Math.sin(lat * RAD) * Math.cos(zenith * RAD) - Math.sin(declination * RAD)) / denom;
    azArg = Math.min(1, Math.max(-1, azArg));
    const az = Math.acos(azArg) * DEG;
    azimuth = hourAngle > 0 ? (az + 180) % 360 : (540 - az) % 360;
  } else {
    // Sun at zenith/nadir or observer at pole: azimuth is degenerate.
    azimuth = lat > 0 ? 180 : 0;
  }

  return {
    elevation,
    apparentElevation: elevation + refractionCorrection(elevation),
    azimuth,
    declination,
    eqOfTimeMin,
    hourAngle,
  };
}

/**
 * Sunrise, sunset, solar noon and related daily facts.
 * Returns times as minutes after local midnight; sunrise/sunset are null in
 * polar day/night (with `polar` saying which).
 */
export function dayInfo(lat, lon, date, tzOffset) {
  // Geometry at local solar noon for the declination/EoT of the day.
  const jdNoon = julianDay(date.year, date.month, date.day) + (12 - tzOffset) / 24;
  const { declination, eqOfTimeMin } = solarGeometry(jdNoon);

  const solarNoon = 720 - 4 * lon - eqOfTimeMin + 60 * tzOffset;
  const noonElevation = 90 - Math.abs(lat - declination);

  const cosHA =
    Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(declination * RAD)) -
    Math.tan(lat * RAD) * Math.tan(declination * RAD);

  let sunrise = null;
  let sunset = null;
  let dayLength; // minutes
  let polar = null;
  if (cosHA > 1) {
    polar = 'night';
    dayLength = 0;
  } else if (cosHA < -1) {
    polar = 'day';
    dayLength = 1440;
  } else {
    const ha = Math.acos(cosHA) * DEG;
    sunrise = solarNoon - ha * 4;
    sunset = solarNoon + ha * 4;
    dayLength = ha * 8;
  }

  return { declination, eqOfTimeMin, solarNoon, noonElevation, sunrise, sunset, dayLength, polar };
}

/**
 * Local times when the sun crosses a given elevation, morning and evening.
 *
 * This is the same hour-angle solution sunrise/sunset uses, generalised to any
 * threshold — so the twilights, the golden hour and the UV-B window all come
 * from one place instead of three near-copies.
 *
 * @param {number} elevationDeg the elevation to cross, e.g. -6 for civil dusk
 * @returns {{state:'crosses'|'always-above'|'never-reaches',
 *            morning:number|null, evening:number|null}}
 *   times in minutes after local midnight; null when the sun stays entirely
 *   above ('always-above') or entirely below ('never-reaches') the threshold.
 */
export function elevationTimes(lat, lon, date, tzOffset, elevationDeg) {
  const jdNoon = julianDay(date.year, date.month, date.day) + (12 - tzOffset) / 24;
  const { declination, eqOfTimeMin } = solarGeometry(jdNoon);
  const solarNoon = 720 - 4 * lon - eqOfTimeMin + 60 * tzOffset;

  const zenith = 90 - elevationDeg;
  const cosHA =
    (Math.cos(zenith * RAD) - Math.sin(lat * RAD) * Math.sin(declination * RAD)) /
    (Math.cos(lat * RAD) * Math.cos(declination * RAD));

  if (cosHA > 1) return { state: 'never-reaches', morning: null, evening: null };
  if (cosHA < -1) return { state: 'always-above', morning: null, evening: null };
  const ha = Math.acos(cosHA) * DEG;
  return { state: 'crosses', morning: solarNoon - ha * 4, evening: solarNoon + ha * 4 };
}

/**
 * Solar elevation above which meaningful cutaneous vitamin D synthesis can
 * happen. Below roughly this angle the atmospheric path is long enough that
 * almost no UV-B (290-315nm) reaches the ground, which is what produces the
 * "vitamin D winter" at higher latitudes. The exact figure varies with ozone,
 * altitude, surface and skin, so treat it as a boundary, not a promise.
 */
export const UVB_ELEVATION = 30;

/**
 * Every named light phase of one day, from one solver.
 *
 * Golden and blue hour follow the common photographic definitions (golden
 * -4 to +6 degrees, blue -6 to -4); the twilights follow the standard
 * -6 / -12 / -18 boundaries.
 */
export function dayLightPhases(lat, lon, date, tzOffset) {
  const at = (e) => elevationTimes(lat, lon, date, tzOffset, e);
  return {
    astronomical: at(-18),
    nautical: at(-12),
    civil: at(-6),
    blue: at(-4),
    sunrise: at(-0.833),
    golden: at(6),
    uvb: at(UVB_ELEVATION),
  };
}

/**
 * Relative air mass for an apparent elevation (deg), Kasten & Young (1989).
 * Returns Infinity when the sun is below the horizon.
 */
export function airMass(apparentElevation) {
  if (apparentElevation <= 0) return Infinity;
  const z = 90 - apparentElevation;
  return 1 / (Math.cos(z * RAD) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}

const SOLAR_CONSTANT = 1361; // W/m^2

/**
 * Clear-sky irradiance estimate for an apparent elevation (degrees).
 * DNI from the Meinel/ASCE attenuation model, diffuse as a simple fraction,
 * GHI = DNI*sin(elev) + diffuse. This is an idealized cloud-free estimate.
 * @returns {{dni:number, diffuse:number, ghi:number}} W/m^2
 */
export function clearSkyIrradiance(apparentElevation) {
  if (apparentElevation <= 0) return { dni: 0, diffuse: 0, ghi: 0 };
  const am = airMass(apparentElevation);
  const dni = SOLAR_CONSTANT * 0.7 ** (am ** 0.678);
  const diffuse = 0.1 * dni;
  const ghi = dni * Math.sin(apparentElevation * RAD) + diffuse;
  return { dni, diffuse, ghi };
}

/**
 * Integrate clear-sky GHI over one day -> kWh/m^2 (cloud-free insolation).
 */
export function dailyInsolation(lat, lon, date, tzOffset, stepMin = 10) {
  let wh = 0;
  for (let m = 0; m < 1440; m += stepMin) {
    const pos = sunPosition(lat, lon, date, m + stepMin / 2, tzOffset);
    wh += clearSkyIrradiance(pos.apparentElevation).ghi * (stepMin / 60);
  }
  return wh / 1000;
}

/** Compass point ("SSE") for an azimuth in degrees. */
export function compassPoint(azimuth) {
  const pts = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return pts[Math.round((((azimuth % 360) + 360) % 360) / 22.5) % 16];
}

/** Days in a month (Gregorian). */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
