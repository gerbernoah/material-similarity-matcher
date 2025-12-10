import type { AvailableTime, Location, ScoreBreakdown, Size } from "./types";

// Default score breakdown with all zeros
export const DEFAULT_SCORE_BREAKDOWN: ScoreBreakdown = {
	name: 0,
	description: 0,
	price: 0,
	quality: 0,
	location: 0,
	availability: 0,
	size: 0,
};

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

	// If weights are already normalized (sum to ~1.0), don't divide again
	// Allow small floating point tolerance
	const isNormalized = Math.abs(totalWeight - 1.0) < 0.0001;

	return isNormalized ? weightedScoreSum : weightedScoreSum / totalWeight;
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
	if (!expected || !match) return undefined;

	const widthScore = closerIsBetterScore(expected?.width, match?.width);
	const heightScore = closerIsBetterScore(expected?.height, match?.height);
	const depthScore = closerIsBetterScore(expected?.depth, match?.depth);

	const scores = [
		{ score: widthScore, weight: 1 },
		{ score: heightScore, weight: 1 },
		{ score: depthScore, weight: 1 },
	].filter((s) => s.score !== undefined);

	if (scores.length === 0) return undefined;

	return combinedScore(scores);
}

/**
 * Calculate distance in meters between two locations using Haversine formula.
 * Returns undefined if either location is missing required coordinates.
 */
export function distanceInMeters(
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

	const R = 6371e3; // Earth's radius in metres
	const φ1 = (expected.latitude * Math.PI) / 180;
	const φ2 = (match.latitude * Math.PI) / 180;
	const Δφ = ((match.latitude - expected.latitude) * Math.PI) / 180;
	const Δλ = ((match.longitude - expected.longitude) * Math.PI) / 180;

	const a =
		Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
		Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

	return R * c; // in metres
}

/**
 * Check if a location is within a given radius (in kilometers).
 * Returns true if within radius, false otherwise.
 */
export function isWithinRadius(
	center?: Location,
	point?: Location,
	radiusKm?: number,
): boolean {
	if (!center || !point || !radiusKm) return true; // No filter if missing data

	const distanceM = distanceInMeters(center, point);
	if (distanceM === undefined) return true;

	return distanceM <= radiusKm * 1000;
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
	const d = distanceInMeters(expected, match);
	if (d === undefined) return undefined;

	// k = decay constant (distance at which score = 0.5)
	const k = 10000; // 10km
	return 1 / (1 + d / k);
}

/**
 * Check if two time ranges overlap.
 * Returns true if they overlap or if any required data is missing.
 */
export function timeRangesOverlap(
	searchFrom?: string,
	searchTo?: string,
	materialFrom?: string,
	materialTo?: string,
): boolean {
	// If no search filter, everything matches
	if (!searchFrom && !searchTo) return true;
	// If material has no time info, include it
	if (!materialFrom && !materialTo) return true;

	const searchStart = searchFrom ? new Date(searchFrom).getTime() : -Infinity;
	const searchEnd = searchTo ? new Date(searchTo).getTime() : Infinity;
	const materialStart = materialFrom
		? new Date(materialFrom).getTime()
		: -Infinity;
	const materialEnd = materialTo ? new Date(materialTo).getTime() : Infinity;

	// Check for overlap: NOT (one ends before the other starts)
	return !(searchEnd < materialStart || materialEnd < searchStart);
}

/**
 * Score based on time range overlap.
 * Returns 1 for perfect overlap, decreasing based on how much the ranges don't overlap.
 */
export function availabilityScore(
	expected?: AvailableTime,
	match?: AvailableTime,
): number | undefined {
	if (!expected || !match) return undefined;
	if (!expected.from && !expected.to) return undefined;
	if (!match.from && !match.to) return undefined;

	const searchStart = expected.from
		? new Date(expected.from).getTime()
		: -Infinity;
	const searchEnd = expected.to ? new Date(expected.to).getTime() : Infinity;
	const materialStart = match.from ? new Date(match.from).getTime() : -Infinity;
	const materialEnd = match.to ? new Date(match.to).getTime() : Infinity;

	// No overlap
	if (searchEnd < materialStart || materialEnd < searchStart) {
		return 0;
	}

	// Calculate overlap
	const overlapStart = Math.max(searchStart, materialStart);
	const overlapEnd = Math.min(searchEnd, materialEnd);
	const overlapDuration = overlapEnd - overlapStart;

	// Calculate the search duration (what user is looking for)
	const searchDuration =
		searchEnd === Infinity || searchStart === -Infinity
			? overlapDuration
			: searchEnd - searchStart;

	if (searchDuration <= 0) return 1;

	// Score is the ratio of overlap to what the user searched for
	return Math.min(1, overlapDuration / searchDuration);
}
