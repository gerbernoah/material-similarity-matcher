import { materialsToFieldEmbeddings } from "./util/embedding";
import {
	availabilityScore,
	combinedScore,
	distance,
	isWithinRadius,
	lowerIsBetterScore,
	sizeScore,
	timeRangesOverlap,
} from "./util/retrievalScores";
import type {
	AvailableTimeRange,
	LocationSearch,
	MaterialWithId,
	MaterialWithoutId,
	MetaData,
	ScoreBreakdown,
	SearchConstraints,
	Weights,
} from "./util/types";

// Minimum score required for hard constraints (80%)
const HARD_CONSTRAINT_MIN_SCORE = 0.8;

// Default weights for scoring
const DEFAULT_WEIGHTS: Weights = {
	w_name: 0.2,
	w_desc: 0.2,
	w_price: 0.15,
	w_quality: 0.15,
	w_location: 0.1,
	w_availability: 0.1,
	w_size: 0.1,
};

/**
 * Detect which fields the user actually provided in their search query.
 * Returns true only if the field has meaningful data (not defaults/empty).
 */
function isFieldProvided(material: MaterialWithoutId): {
	hasName: boolean;
	hasDescription: boolean;
	hasPrice: boolean;
	hasQuality: boolean;
	hasLocation: boolean;
	hasAvailability: boolean;
	hasSize: boolean;
} {
	return {
		hasName: !!material.name && material.name.trim().length > 0,
		hasDescription:
			!!material.description && material.description.trim().length > 0,
		hasPrice:
			material.price !== undefined &&
			material.price !== null &&
			material.price > 0,
		hasQuality:
			material.quality !== undefined &&
			material.quality !== null &&
			material.quality >= 0.5, // Valid quality is 0.5-1.0, treat < 0.5 as not provided
		hasLocation:
			!!material.location &&
			(material.location.latitude !== 0 || material.location.longitude !== 0) &&
			// Check if it's a meaningful location (not just default/placeholder)
			Math.abs(material.location.latitude) > 0.0001 &&
			Math.abs(material.location.longitude) > 0.0001,
		hasAvailability:
			!!material.availableTime &&
			(!!material.availableTime.from || !!material.availableTime.to),
		hasSize:
			!!material.size &&
			(!!material.size.width ||
				!!material.size.height ||
				!!material.size.depth),
	};
}

/**
 * Calculate normalized weights based on which fields were actually provided.
 * Only active fields get non-zero weights, and they sum to 1.0.
 */
function calculateActiveWeights(material: MaterialWithoutId): Weights {
	const provided = isFieldProvided(material);
	const baseWeights = { ...DEFAULT_WEIGHTS };

	// Zero out weights for unprovided fields
	const activeWeights: Weights = {
		w_name: provided.hasName ? baseWeights.w_name : 0,
		w_desc: provided.hasDescription ? baseWeights.w_desc : 0,
		w_price: provided.hasPrice ? baseWeights.w_price : 0,
		w_quality: provided.hasQuality ? baseWeights.w_quality : 0,
		w_location: provided.hasLocation ? baseWeights.w_location : 0,
		w_availability: provided.hasAvailability ? baseWeights.w_availability : 0,
		w_size: provided.hasSize ? baseWeights.w_size : 0,
	};

	// Calculate sum of active weights
	const totalWeight =
		activeWeights.w_name +
		activeWeights.w_desc +
		activeWeights.w_price +
		activeWeights.w_quality +
		activeWeights.w_location +
		activeWeights.w_availability +
		activeWeights.w_size;

	// Normalize to sum to 1.0 if we have any active fields
	if (totalWeight > 0) {
		activeWeights.w_name /= totalWeight;
		activeWeights.w_desc /= totalWeight;
		activeWeights.w_price /= totalWeight;
		activeWeights.w_quality /= totalWeight;
		activeWeights.w_location /= totalWeight;
		activeWeights.w_availability /= totalWeight;
		activeWeights.w_size /= totalWeight;
	}

	return activeWeights;
}

/**
 * Check if material passes all hard constraint filters.
 * Returns true if all hard constraints have scores >= 80%, false otherwise.
 * Note: Location and availableTime hard constraints are handled separately via radius/time filters.
 */
function passesHardConstraints(
	scoreBreakdown: ScoreBreakdown,
	constraints?: SearchConstraints,
): boolean {
	if (!constraints) return true;

	if (
		constraints.name === "hard" &&
		scoreBreakdown.name < HARD_CONSTRAINT_MIN_SCORE
	) {
		return false;
	}
	if (
		constraints.description === "hard" &&
		scoreBreakdown.description < HARD_CONSTRAINT_MIN_SCORE
	) {
		return false;
	}
	if (
		constraints.price === "hard" &&
		scoreBreakdown.price < HARD_CONSTRAINT_MIN_SCORE
	) {
		return false;
	}
	if (
		constraints.condition === "hard" &&
		scoreBreakdown.quality < HARD_CONSTRAINT_MIN_SCORE
	) {
		return false;
	}
	// Note: location "hard" is handled by radius filter, not score threshold
	if (
		constraints.dimensions === "hard" &&
		scoreBreakdown.size < HARD_CONSTRAINT_MIN_SCORE
	) {
		return false;
	}
	// Note: availability "hard" is handled by time overlap filter

	return true;
}

type RetrievalMatch = {
	materialId: string;
	score: number;
	scoreBreakdown: ScoreBreakdown;
};

export type RetrievalResult = {
	matches: RetrievalMatch[];
	weights: Weights;
};

export type RetrievalOptions = {
	constraints?: SearchConstraints;
	location?: LocationSearch;
	availableTime?: AvailableTimeRange;
};

export async function retrieveSimilarMaterials(
	env: Env,
	topK: number,
	material: MaterialWithoutId,
	options?: RetrievalOptions,
): Promise<RetrievalResult> {
	// Calculate active weights based on which fields user actually provided
	const weights = calculateActiveWeights(material);
	const provided = isFieldProvided(material);

	const queryEmbeddings = await materialsToFieldEmbeddings(env, [material]);
	const queryEmb = queryEmbeddings[0];

	// Query name and description vectors (metadata stored with name vectors)
	const [nameResponse, descResponse] = await Promise.all([
		env.VECTORIZE_NAME.query(queryEmb.name, { topK, returnMetadata: "all" }),
		env.VECTORIZE_DESC.query(queryEmb.desc, { topK, returnMetadata: "none" }),
	]);

	// Build metadata map from name response (stores all metadata)
	const metadataMap = new Map<string, MetaData>();
	for (const match of nameResponse.matches) {
		metadataMap.set(match.id, match.metadata as MetaData);
	}

	// Create a map to aggregate scores by material ID
	const scoreMap = new Map<
		string,
		{
			nameScore: number;
			descScore: number;
		}
	>();

	// Process name matches
	for (const match of nameResponse.matches) {
		scoreMap.set(match.id, {
			nameScore: match.score,
			descScore: 0,
		});
	}

	// Process description matches
	for (const match of descResponse.matches) {
		const existing = scoreMap.get(match.id);
		if (existing) {
			existing.descScore = match.score;
		} else {
			scoreMap.set(match.id, {
				nameScore: 0,
				descScore: match.score,
			});
		}
	}

	const queryMatches: RetrievalMatch[] = [];

	for (const [materialId, scores] of scoreMap) {
		const metadata = metadataMap.get(materialId);

		// Apply location filter only if location constraint is "hard"
		if (options?.location && options?.constraints?.location === "hard") {
			const withinRadius = isWithinRadius(
				options.location,
				metadata?.location,
				options.location.radiusKm,
			);
			if (!withinRadius) continue;
		}

		// Apply time filter only if availability constraint is "hard"
		if (
			options?.availableTime &&
			options?.constraints?.availability === "hard"
		) {
			const overlaps = timeRangesOverlap(
				options.availableTime.from,
				options.availableTime.to,
				metadata?.availableTime?.from,
				metadata?.availableTime?.to,
			);
			if (!overlaps) continue;
		}

		// Calculate individual scores ONLY for fields that were provided
		const s_price = provided.hasPrice
			? lowerIsBetterScore(material?.price, metadata?.price)
			: undefined;
		const s_quality = provided.hasQuality
			? lowerIsBetterScore(metadata?.quality, material?.quality)
			: undefined;
		const s_location = provided.hasLocation
			? distance(material?.location, metadata?.location)
			: undefined;
		const s_availability = provided.hasAvailability
			? availabilityScore(material?.availableTime, metadata?.availableTime)
			: undefined;
		const s_size = provided.hasSize
			? sizeScore(material?.size, metadata?.size)
			: undefined;

		// Build score breakdown (individual scores before weighting)
		const scoreBreakdown: ScoreBreakdown = {
			name: scores.nameScore,
			description: scores.descScore,
			price: s_price ?? 0,
			quality: s_quality ?? 0,
			location: s_location ?? 0,
			availability: s_availability ?? 0,
			size: s_size ?? 0,
		};

		// Filter out materials that don't pass hard constraints (< 80% match)
		if (!passesHardConstraints(scoreBreakdown, options?.constraints)) {
			continue;
		}

		// Calculate combined score using weights - only include provided fields
		const scoreComponents = [
			{ score: scores.nameScore, weight: weights.w_name },
			{ score: scores.descScore, weight: weights.w_desc },
		];

		// Only add scores for fields that were actually provided
		if (provided.hasPrice && s_price !== undefined) {
			scoreComponents.push({ score: s_price, weight: weights.w_price });
		}
		if (provided.hasQuality && s_quality !== undefined) {
			scoreComponents.push({ score: s_quality, weight: weights.w_quality });
		}
		if (provided.hasLocation && s_location !== undefined) {
			scoreComponents.push({ score: s_location, weight: weights.w_location });
		}
		if (provided.hasAvailability && s_availability !== undefined) {
			scoreComponents.push({
				score: s_availability,
				weight: weights.w_availability,
			});
		}
		if (provided.hasSize && s_size !== undefined) {
			scoreComponents.push({ score: s_size, weight: weights.w_size });
		}

		const s_combined = combinedScore(scoreComponents);

		queryMatches.push({
			materialId,
			score: s_combined,
			scoreBreakdown,
		});
	}

	// Sort by score descending and take topK
	queryMatches.sort((a, b) => b.score - a.score);
	const topMatches = queryMatches.slice(0, topK);

	// Recalculate weights based on which fields actually had scores across all results
	// This handles cases where user provides a field but no stored materials have that data
	const hasAnyScore = {
		name: topMatches.some((m) => m.scoreBreakdown.name > 0),
		description: topMatches.some((m) => m.scoreBreakdown.description > 0),
		price: topMatches.some((m) => m.scoreBreakdown.price > 0),
		quality: topMatches.some((m) => m.scoreBreakdown.quality > 0),
		location: topMatches.some((m) => m.scoreBreakdown.location > 0),
		availability: topMatches.some((m) => m.scoreBreakdown.availability > 0),
		size: topMatches.some((m) => m.scoreBreakdown.size > 0),
	};

	// Adjust weights: zero out fields that had no scores
	const adjustedWeights: Weights = {
		w_name: hasAnyScore.name ? weights.w_name : 0,
		w_desc: hasAnyScore.description ? weights.w_desc : 0,
		w_price: hasAnyScore.price ? weights.w_price : 0,
		w_quality: hasAnyScore.quality ? weights.w_quality : 0,
		w_location: hasAnyScore.location ? weights.w_location : 0,
		w_availability: hasAnyScore.availability ? weights.w_availability : 0,
		w_size: hasAnyScore.size ? weights.w_size : 0,
	};

	// Renormalize to sum to 1.0
	const totalAdjustedWeight =
		adjustedWeights.w_name +
		adjustedWeights.w_desc +
		adjustedWeights.w_price +
		adjustedWeights.w_quality +
		adjustedWeights.w_location +
		adjustedWeights.w_availability +
		adjustedWeights.w_size;

	if (totalAdjustedWeight > 0) {
		adjustedWeights.w_name /= totalAdjustedWeight;
		adjustedWeights.w_desc /= totalAdjustedWeight;
		adjustedWeights.w_price /= totalAdjustedWeight;
		adjustedWeights.w_quality /= totalAdjustedWeight;
		adjustedWeights.w_location /= totalAdjustedWeight;
		adjustedWeights.w_availability /= totalAdjustedWeight;
		adjustedWeights.w_size /= totalAdjustedWeight;
	}

	return {
		matches: topMatches,
		weights: adjustedWeights,
	};
}

function buildMetadata(material: MaterialWithId): MetaData {
	return {
		quality: material.quality,
		price: material.price,
		...(material.location && {
			location: {
				latitude: material.location.latitude,
				longitude: material.location.longitude,
			},
		}),
		...(material.size && {
			size: {
				...(material.size.width && { width: material.size.width }),
				...(material.size.height && { height: material.size.height }),
				...(material.size.depth && { depth: material.size.depth }),
			},
		}),
		...(material.availableTime && {
			availableTime: {
				...(material.availableTime.from && {
					from: material.availableTime.from,
				}),
				...(material.availableTime.to && { to: material.availableTime.to }),
			},
		}),
	};
}

function materialToVectorizeVector(
	id: string,
	vector: number[],
	meta?: MaterialWithId,
): VectorizeVector {
	return {
		id,
		values: vector,
		...(meta && { metadata: buildMetadata(meta) }),
	};
}

export async function addMaterialsToVectorStore(
	env: Env,
	materials: MaterialWithId[],
) {
	const fieldEmbeddings = await materialsToFieldEmbeddings(env, materials);

	const ebkpVectors: VectorizeVector[] = [];
	const nameVectors: VectorizeVector[] = [];
	const descVectors: VectorizeVector[] = [];

	fieldEmbeddings.forEach((embeddings, index) => {
		const material = materials[index];
		// Store EBKP embeddings without metadata (for potential future use)
		ebkpVectors.push(
			materialToVectorizeVector(material.id, embeddings.ebkp, undefined),
		);
		// Name vectors now include metadata (used for retrieval)
		nameVectors.push(
			materialToVectorizeVector(material.id, embeddings.name, material),
		);
		descVectors.push(
			materialToVectorizeVector(material.id, embeddings.desc, undefined),
		);
	});

	// Store all embeddings in their respective vector stores
	await Promise.all([
		env.VECTORIZE_EBKP.upsert(ebkpVectors),
		env.VECTORIZE_NAME.upsert(nameVectors),
		env.VECTORIZE_DESC.upsert(descVectors),
	]);
}
