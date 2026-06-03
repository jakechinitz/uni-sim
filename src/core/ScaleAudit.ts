export interface ScaleAuditRow {
  label: string;
  visual: string;
  trueScale: string;
  factor: string;
}

const KPC_IN_KM = 3.0856775814913673e16;
const RS_KM_PER_SOLAR_MASS = 2.95325008;
const RS_SIM_UNITS_PER_SOLAR_MASS = RS_KM_PER_SOLAR_MASS / KPC_IN_KM;

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

export function scaleAuditRows(): ScaleAuditRow[] {
  const centralMinMass = 10 ** 5.5;
  const centralMaxMass = 10 ** 9.5;
  const centralMinVisual = 0.11;
  const centralMaxVisual = 0.33;
  const centralMinTrue = trueRadiusSimUnits(centralMinMass);
  const centralMaxTrue = trueRadiusSimUnits(centralMaxMass);

  const stellarMinMass = 5;
  const stellarMaxMass = 40;
  const stellarMinVisual = 0.033 + 0.022 * (stellarMinMass / 40);
  const stellarMaxVisual = 0.033 + 0.022 * (stellarMaxMass / 40);
  const stellarMinTrue = trueRadiusSimUnits(stellarMinMass);
  const stellarMaxTrue = trueRadiusSimUnits(stellarMaxMass);

  return [
    {
      label: 'Center SMBH',
      visual: '0.11-0.33 sim radius',
      trueScale: `${formatSci(centralMinTrue)}-${formatSci(centralMaxTrue)} sim radius`,
      factor: formatFactor(centralMaxVisual / centralMaxTrue, centralMinVisual / centralMinTrue),
    },
    {
      label: 'Periphery BH',
      visual: '0.036-0.055 sim radius',
      trueScale: `${formatSci(stellarMinTrue)}-${formatSci(stellarMaxTrue)} sim radius`,
      factor: formatFactor(stellarMaxVisual / stellarMaxTrue, stellarMinVisual / stellarMinTrue),
    },
    {
      label: 'Previous visual map',
      visual: 'current radii are 55% of old map',
      trueScale: 'center ~0.20-0.60; periphery ~0.065-0.100',
      factor: 'old map was another ~1.8x larger',
    },
  ];
}
