import type { Location, Size } from "./types";

export function combinedScore(
	scores: { score?: number; weight: number }[],
): number {
	if (scores.length === 0) return 0;

	let totalWeight = 0;
	let weightedScoreSum = 0;

	scores.forEach(({ score, weight }) => {
		if (score !== undefined) {
			weightedScoreSum += score * weight;
			totalWeight += weight;
		}
	});

	if (totalWeight === 0) return 0;

	return weightedScoreSum / totalWeight;
}

/**
 * Score based on how close match is to expected.
 * Uses monotonic transformation: score = 1 / (1 + r) where r = |expected - match| / expected
 * Returns 1 when match === expected, asymptotically approaches 0 as difference increases.
 */
export function closerIsBetterScore(
	expected?: number,
	match?: number,
): number | undefined {
	if (expected === undefined || match === undefined) return undefined;
	if (expected === 0 && match === 0) return 1;
	if (expected === 0) return 1 / (1 + Math.abs(match));

	const r = Math.abs(expected - match) / expected;
	return 1 / (1 + r);
}

/**
 * Score where lower match values are better (e.g., price).
 * Uses monotonic transformation: score = 1 / (1 + r) where r = max(0, (match - expected) / expected)
 * Returns 1 when match <= expected, asymptotically approaches 0 as match exceeds expected.
 */
export function lowerIsBetterScore(
	expected?: number,
	match?: number,
): number | undefined {
	if (expected === undefined || match === undefined) return undefined;
	if (match <= 0) return 1; // match is 0 or negative, best possible
	if (expected <= 0) return 1 / (1 + match); // we want 0, penalize based on match

	// When match <= expected, score = 1 (perfect)
	// When match > expected, score decreases smoothly
	const r = Math.max(0, (match - expected) / expected);
	return 1 / (1 + r);
}

export function sizeScore(expected?: Size, match?: Size): number | undefined {
	const widthScore = closerIsBetterScore(expected?.width, match?.width);
	const heightScore = closerIsBetterScore(expected?.height, match?.height);
	const depthScore = closerIsBetterScore(expected?.depth, match?.depth);

	return combinedScore([
		{ score: widthScore, weight: 1 },
		{ score: heightScore, weight: 1 },
		{ score: depthScore, weight: 1 },
	]);
}

/**
 * Score based on geographical distance between two locations.
 * Uses monotonic transformation: score = 1 / (1 + d/k) where d is distance in meters.
 * k controls the decay rate (default 10km = 10000m means score = 0.5 at 10km distance).
 */
export function distance(
	expected?: Location,
	match?: Location,
): number | undefined {
	if (
		!expected?.latitude ||
		!expected?.longitude ||
		!match?.latitude ||
		!match?.longitude
	)
		return undefined;

	const R = 6371e3; // metres
	const φ1 = (expected.latitude * Math.PI) / 180; // φ, λ in radians
	const φ2 = (match.latitude * Math.PI) / 180;
	const Δφ = ((match.latitude - expected.latitude) * Math.PI) / 180;
	const Δλ = ((match.longitude - expected.longitude) * Math.PI) / 180;

	const a =
		Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
		Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	const d = R * c; // in metres

	// k = decay constant (distance at which score = 0.5)
	const k = 10000; // 10km
	return 1 / (1 + d / k);
}
