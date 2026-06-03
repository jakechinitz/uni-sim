export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  level: QualityLevel;
  label: string;
  pixelRatioCap: number;
  lensing: boolean;
  maxLensSources: number;
  physicsStride: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low',
    label: 'Low',
    pixelRatioCap: 1,
    lensing: false,
    maxLensSources: 0,
    physicsStride: 2,
  },
  medium: {
    level: 'medium',
    label: 'Medium',
    pixelRatioCap: 1.5,
    lensing: true,
    maxLensSources: 12,
    physicsStride: 1,
  },
  high: {
    level: 'high',
    label: 'High',
    pixelRatioCap: 2,
    lensing: true,
    maxLensSources: 32,
    physicsStride: 1,
  },
};

export function qualityForLevel(level: unknown): QualitySettings {
  if (level === 'low' || level === 'medium' || level === 'high') return QUALITY_PRESETS[level];
  return QUALITY_PRESETS.medium;
}

export function detectDefaultQuality(): QualityLevel {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'medium';

  const nav = navigator as Navigator & { deviceMemory?: number };
  const memoryLimited = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
  const coreLimited = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrowViewport = window.matchMedia?.('(max-width: 760px)').matches ?? false;

  return memoryLimited || coreLimited || coarsePointer || narrowViewport ? 'low' : 'medium';
}
