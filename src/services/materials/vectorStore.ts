import { materialsToFieldEmbeddings } from "./util/embedding";
import {
	availabilityScore,
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

/**
 * Convert weights from 0-100 range to 0-1 range for internal calculations
 */
function normalizeWeights(weights: Weights): Weights {
	return {
		w_name: weights.w_name / 100,
		w_desc: weights.w_desc / 100,
		w_price: weights.w_price / 100,
		w_quality: weights.w_quality / 100,
		w_location: weights.w_location / 100,
		w_availability: weights.w_availability / 100,
		w_size: weights.w_size / 100,
	};
}

/**
 * Convert weights from 0-1 range to 0-100 range for response
 */
function denormalizeWeights(weights: Weights): Weights {
	return {
		w_name: Math.round(weights.w_name * 100),
		w_desc: Math.round(weights.w_desc * 100),
		w_price: Math.round(weights.w_price * 100),
		w_quality: Math.round(weights.w_quality * 100),
		w_location: Math.round(weights.w_location * 100),
		w_availability: Math.round(weights.w_availability * 100),
		w_size: Math.round(weights.w_size * 100),
	};
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
	weights: Weights; // Required weights from request
};

export async function retrieveSimilarMaterials(
	env: Env,
	topK: number,
	material: MaterialWithoutId,
	options: RetrievalOptions,
): Promise<RetrievalResult> {
	// Normalize weights from 0-100 to 0-1 range for internal calculations
	// Force w_name to 0 as name is for matching, not weighted scoring
	const normalizedWeights = normalizeWeights(options.weights);
	normalizedWeights.w_name = 0;

	// Renormalize weights excluding w_name to maintain sum of 1.0
	const totalWeightWithoutName =
		normalizedWeights.w_desc +
		normalizedWeights.w_price +
		normalizedWeights.w_quality +
		normalizedWeights.w_location +
		normalizedWeights.w_availability +
		normalizedWeights.w_size;

	if (totalWeightWithoutName > 0) {
		const scale = 1.0 / totalWeightWithoutName;
		normalizedWeights.w_desc *= scale;
		normalizedWeights.w_price *= scale;
		normalizedWeights.w_quality *= scale;
		normalizedWeights.w_location *= scale;
		normalizedWeights.w_availability *= scale;
		normalizedWeights.w_size *= scale;
	}

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

		// Calculate individual scores for all fields (0-1 range, before weighting)
		const s_price = lowerIsBetterScore(material?.price, metadata?.price) ?? 0;
		const s_quality =
			lowerIsBetterScore(metadata?.quality, material?.quality) ?? 0;
		const s_location = distance(material?.location, metadata?.location) ?? 0;
		const s_availability =
			availabilityScore(material?.availableTime, metadata?.availableTime) ?? 0;
		const s_size = sizeScore(material?.size, metadata?.size) ?? 0;

		// Build score breakdown (individual scores before weighting)
		const scoreBreakdown: ScoreBreakdown = {
			name: scores.nameScore,
			description: scores.descScore,
			price: s_price,
			quality: s_quality,
			location: s_location,
			availability: s_availability,
			size: s_size,
		};

		// Filter out materials that don't pass hard constraints (< 80% match)
		if (!passesHardConstraints(scoreBreakdown, options?.constraints)) {
			continue;
		}

		// Calculate combined score using provided weights
		// Formula: (name × w_name + desc × w_desc + ... ) / 100
		// Since w_name is always 0, it doesn't contribute
		const s_combined =
			scores.nameScore * normalizedWeights.w_name +
			scores.descScore * normalizedWeights.w_desc +
			s_price * normalizedWeights.w_price +
			s_quality * normalizedWeights.w_quality +
			s_location * normalizedWeights.w_location +
			s_availability * normalizedWeights.w_availability +
			s_size * normalizedWeights.w_size;

		queryMatches.push({
			materialId,
			score: s_combined,
			scoreBreakdown,
		});
	}

	// Sort by score descending and take topK
	queryMatches.sort((a, b) => b.score - a.score);
	const topMatches = queryMatches.slice(0, topK);

	// Return the weights that were used (in 0-1 range)
	return {
		matches: topMatches,
		weights: normalizedWeights,
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
