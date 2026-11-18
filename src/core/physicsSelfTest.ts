import { computeClosure, leptonLadder } from './Closure';
import { nuRAR } from './Gravity';
import { SubstrateSim } from './SubstrateSim';
import { traceChi, edePulse, checkpoints, LITTLE_H, OMEGA_LAMBDA, T_TODAY, a as scaleFactor } from './Cosmology';

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
    pass: Math.abs(closure.G_dev_pct) < 0.01 && Math.abs(closure.G_dev_0_pct + 1.05) < 0.05 && near(closure.a_0, 1.27e-10, 0.02e-10),
    details: `G_dev=${closure.G_dev_pct.toFixed(3)}%, a0=${closure.a_0.toExponential(3)}`,
  });

  const radiation = traceChi(1e-10);
  const late = traceChi(0.15);
  const pulseEarly = edePulse(1e-10), pulsePeak = edePulse(checkpoints.T_RAD_END), pulseLate = edePulse(0.15);
  checks.push({
    name: 'Trace switch and early pulse',
    pass: radiation < 0.01 && late > 0.98 && pulseEarly < 0.01 && pulsePeak > 0.7 && pulseLate < 0.01,
    details: `chi(rad)=${radiation.toFixed(4)}, chi(late)=${late.toFixed(4)}, pulse=${pulseEarly.toFixed(3)}/${pulsePeak.toFixed(3)}/${pulseLate.toFixed(3)}`,
  });

  // Integrated background reproduces the paper's no-fit outputs.
  checks.push({
    name: 'Background: h, Ω_Λ, a(today) from ω_b and the release history',
    pass: near(LITTLE_H, 0.693, 0.004) && near(OMEGA_LAMBDA, 0.709, 0.004) && near(scaleFactor(T_TODAY), 1, 1e-3),
    details: `h=${LITTLE_H.toFixed(4)}, Ω_Λ=${OMEGA_LAMBDA.toFixed(4)}, age=${T_TODAY.toFixed(3)} Gyr`,
  });

  const lep = leptonLadder();
  checks.push({
    name: 'Dressed closure: G* and lepton ratios',
    pass: near(closure.G_star / 6.6742890813e-11, 1, 2e-6) && near(lep.muon.predicted, 206.768280237, 1e-5) && near(lep.tau.predicted, 3477.343310, 1e-3),
    details: `G*=${closure.G_star.toExponential(9)}, mu=${lep.muon.predicted.toFixed(6)}, tau=${lep.tau.predicted.toFixed(4)}`,
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
