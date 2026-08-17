export type ComparisonMode = 'percentage' | 'bounded' | 'zero-required';

export interface PercentageComparison {
  mode: 'percentage' | 'bounded';
  percentage: number | null;
  passed: boolean;
}

export interface SimpleComparison {
  mode: 'bounded' | 'zero-required';
  passed: boolean;
}

export interface CorrectnessFailure {
  arm: 'baseline' | 'candidate';
  repetition: number;
  value: number;
}

export interface FiveRunComparison extends PercentageComparison {
  baselineMedian: number;
  candidateMedian: number;
  absoluteDelta: number;
  rawCorrectnessPassed: boolean;
  correctnessFailures: CorrectnessFailure[];
}

export function nearestRank(samples: readonly number[], percentile: number): number {
  assertFiniteSamples(samples);
  if (samples.length === 0) throw new RangeError('Nearest rank requires at least one sample');
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new RangeError('Percentile must be finite and in (0, 1]');
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(percentile * sorted.length)));
  return sorted[rank - 1];
}

export function medianOfFive(samples: readonly number[]): number {
  if (samples.length !== 5) throw new RangeError('Median requires exactly five samples');
  assertFiniteSamples(samples);
  return [...samples].sort((left, right) => left - right)[2];
}

export function comparePercentage(
  baselineMedian: number,
  candidateMedian: number,
  tolerance: number,
  regressionLimit: number,
): PercentageComparison {
  assertFiniteNonNegative(baselineMedian, 'baselineMedian');
  assertFiniteNonNegative(candidateMedian, 'candidateMedian');
  assertFiniteNonNegative(tolerance, 'tolerance');
  assertFiniteNonNegative(regressionLimit, 'regressionLimit');
  if (baselineMedian <= tolerance) {
    return {
      mode: 'bounded',
      percentage: null,
      passed: candidateMedian <= tolerance,
    };
  }
  const percentage = ((candidateMedian - baselineMedian) / baselineMedian) * 100;
  return { mode: 'percentage', percentage, passed: percentage <= regressionLimit };
}

export function compareBounded(value: number, maximum: number): SimpleComparison {
  assertFiniteNonNegative(value, 'value');
  assertFiniteNonNegative(maximum, 'maximum');
  return { mode: 'bounded', passed: value <= maximum };
}

export function compareZeroRequired(
  baseline: readonly number[],
  candidate: readonly number[],
): SimpleComparison {
  assertFiniteSamples(baseline);
  assertFiniteSamples(candidate);
  return {
    mode: 'zero-required',
    passed: baseline.every((value) => value === 0) && candidate.every((value) => value === 0),
  };
}

export function compareFiveRuns(options: {
  baseline: readonly number[];
  candidate: readonly number[];
  tolerance: number;
  regressionLimit: number;
  isCorrect: (value: number) => boolean;
}): FiveRunComparison {
  const baselineMedian = medianOfFive(options.baseline);
  const candidateMedian = medianOfFive(options.candidate);
  const medianComparison = comparePercentage(
    baselineMedian,
    candidateMedian,
    options.tolerance,
    options.regressionLimit,
  );
  const correctnessFailures: CorrectnessFailure[] = [];
  for (const arm of ['baseline', 'candidate'] as const) {
    options[arm].forEach((value, index) => {
      if (!options.isCorrect(value)) {
        correctnessFailures.push({ arm, repetition: index + 1, value });
      }
    });
  }

  return {
    ...medianComparison,
    baselineMedian,
    candidateMedian,
    absoluteDelta: candidateMedian - baselineMedian,
    rawCorrectnessPassed: correctnessFailures.length === 0,
    passed: correctnessFailures.length === 0 && medianComparison.passed,
    correctnessFailures,
  };
}

function assertFiniteSamples(samples: readonly number[]): void {
  if (!samples.every(Number.isFinite)) throw new TypeError('Samples must all be finite numbers');
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError(`${name} must be finite and non-negative`);
}
