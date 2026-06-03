export interface ScaleAuditRow {
  label: string;
  visual: string;
  trueScale: string;
  factor: string;
}

const KPC_IN_KM = 3.0856775814913673e16;
const RS_KM_PER_SOLAR_MASS = 2.95325008;
const RS_SIM_UNITS_PER_SOLAR_MASS = RS_KM_PER_SOLAR_MASS / KPC_IN_KM;
const DISPLAY_SHRINK = 0.5;

function trueRadiusSimUnits(massSolar: number, kpcPerSimUnit = 1): number {
  return (massSolar * RS_SIM_UNITS_PER_SOLAR_MASS) / kpcPerSimUnit;
}

function formatSci(value: number): string {
  const exp = Math.floor(Math.log10(value));
  const mant = value / 10 ** exp;
  return `${mant.toFixed(mant < 2 ? 1 : 0)}e${exp}`;
}

function formatFactor(minFactor: number, maxFactor: number): string {
  return `~${formatSci(minFactor)}-${formatSci(maxFactor)}x visible`;
}

function fmtRange(min: number, max: number): string {
  return `${min.toFixed(3)}-${max.toFixed(3)}`;
}

export function scaleAuditRows(): ScaleAuditRow[] {
  const centralMinMass = 10 ** 5.5;
  const centralMaxMass = 10 ** 9.5;
  const centralCodeMinVisual = 0.11;
  const centralCodeMaxVisual = 0.33;
  const centralMinVisual = centralCodeMinVisual * DISPLAY_SHRINK;
  const centralMaxVisual = centralCodeMaxVisual * DISPLAY_SHRINK;
  const centralMinTrue = trueRadiusSimUnits(centralMinMass);
  const centralMaxTrue = trueRadiusSimUnits(centralMaxMass);

  const stellarMinMass = 5;
  const stellarMaxMass = 40;
  const stellarCodeMinVisual = 0.033 + 0.022 * (stellarMinMass / 40);
  const stellarCodeMaxVisual = 0.033 + 0.022 * (stellarMaxMass / 40);
  const stellarMinVisual = stellarCodeMinVisual * DISPLAY_SHRINK;
  const stellarMaxVisual = stellarCodeMaxVisual * DISPLAY_SHRINK;
  const stellarMinTrue = trueRadiusSimUnits(stellarMinMass);
  const stellarMaxTrue = trueRadiusSimUnits(stellarMaxMass);

  return [
    {
      label: 'Center SMBH',
      visual: `${fmtRange(centralMinVisual, centralMaxVisual)} sim radius shown; code map before shrink was ${fmtRange(centralCodeMinVisual, centralCodeMaxVisual)}`,
      trueScale: `${formatSci(centralMinTrue)}-${formatSci(centralMaxTrue)} sim radius`,
      factor: formatFactor(centralMaxVisual / centralMaxTrue, centralMinVisual / centralMinTrue),
    },
    {
      label: 'Periphery BH',
      visual: `${fmtRange(stellarMinVisual, stellarMaxVisual)} sim radius shown; code map before shrink was ${fmtRange(stellarCodeMinVisual, stellarCodeMaxVisual)}`,
      trueScale: `${formatSci(stellarMinTrue)}-${formatSci(stellarMaxTrue)} sim radius`,
      factor: formatFactor(stellarMaxVisual / stellarMaxTrue, stellarMinVisual / stellarMinTrue),
    },
    {
      label: 'Why not true scale',
      visual: 'true Schwarzschild disks would be far below a pixel at galaxy view',
      trueScale: 'hover cards keep physical r_s, T_H, S_BH labels literal',
      factor: 'display is still intentionally inflated',
    },
  ];
}
