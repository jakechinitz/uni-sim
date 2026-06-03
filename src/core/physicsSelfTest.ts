import { computeClosure } from './Closure';
import { nuRAR } from './Gravity';
import { SubstrateSim } from './SubstrateSim';
import { traceChi } from './Cosmology';

interface CheckResult {
  name: string;
  pass: boolean;
  details: string;
}

function near(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

export function runPhysicsSelfTest(): void {
  const checks: CheckResult[] = [];

  const newtonLimit = nuRAR(1e6);
  checks.push({
    name: 'RAR Newtonian limit',
    pass: near(newtonLimit, 1, 0.002),
    details: `nu(1e6)=${newtonLimit.toFixed(6)}`,
  });

  const deepMondRatio = nuRAR(1e-8) * Math.sqrt(1e-8);
  checks.push({
    name: 'RAR deep-field asymptote',
    pass: near(deepMondRatio, 1, 0.002),
    details: `nu(y)*sqrt(y)=${deepMondRatio.toFixed(6)}`,
  });

  const closure = computeClosure();
  checks.push({
    name: 'Closure produces observed constants',
    pass: Math.abs(closure.G_dev_pct) < 2 && closure.a0 > 1e-11 && closure.a0 < 2e-10,
    details: `G_dev=${closure.G_dev_pct.toFixed(3)}%, a0=${closure.a0.toExponential(3)}`,
  });

  const radiation = traceChi(1e-8);
  const equality = traceChi(5e-5);
  const late = traceChi(0.15);
  checks.push({
    name: 'Trace mode dormant before equality',
    pass: radiation < equality && late < equality,
    details: `chi(rad)=${radiation.toFixed(3)}, chi(eq)=${equality.toFixed(3)}, chi(late)=${late.toFixed(3)}`,
  });

  const substrate = new SubstrateSim(5);
  substrate.addDefect(2, 2, 2, 8);
  substrate.emitPacket(2, 2, 2, 1, 0, 0, 0.35);
  for (let i = 0; i < 24; i++) substrate.step(0.04);
  substrate.relax(0.5, 0.5);
  const q = substrate.qRange();
  checks.push({
    name: 'Substrate q remains bounded',
    pass: q.min >= 0 && q.max <= 1,
    details: `q=[${q.min.toFixed(4)}, ${q.max.toFixed(4)}]`,
  });

  const failed = checks.filter((check) => !check.pass);
  if (failed.length) {
    console.warn('[physics] self-check failures', failed, checks);
  } else {
    console.info('[physics] self-checks passed', checks);
  }
}
