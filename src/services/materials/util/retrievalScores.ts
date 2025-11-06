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

export function closerIsBetterScore(
	expected?: number,
	match?: number,
): number | undefined {
	if (expected === undefined || match === undefined) return undefined;

	return Math.max(0, 1 - Math.abs(expected - match) / expected);
}

export function lowerIsBetterScore(
	expected?: number,
	match?: number,
): number | undefined {
	if (expected === undefined || match === undefined) return undefined;
	return expected / match;
}

export function sizeScore(expected: Size, match: Size): number | undefined {
	const widthScore = closerIsBetterScore(expected.width, match.width);
	const heightScore = closerIsBetterScore(expected.height, match.height);
	const depthScore = closerIsBetterScore(expected.depth, match.depth);

	return combinedScore([
		{ score: widthScore, weight: 1 },
		{ score: heightScore, weight: 1 },
		{ score: depthScore, weight: 1 },
	]);
}

export function distance(
	expected: Location,
	match: Location,
): number | undefined {
	if (
		!expected.latitude ||
		!expected.longitude ||
		!match.latitude ||
		!match.longitude
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

	const maxDistance = 100000;
	return 1 - Math.min(d, maxDistance) / maxDistance;
}
