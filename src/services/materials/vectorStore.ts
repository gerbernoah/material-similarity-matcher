import { materialsToFieldEmbeddings } from "./util/embedding";
import {
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
	w_ebkp: 0.3,
	w_name: 0.5,
	w_desc: 0.2,
	w_price: 0.2,
	w_quality: 0.1,
	w_position: 0.1,
	w_size: 0.1,
};

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
		constraints.ebkp === "hard" &&
		scoreBreakdown.ebkp < HARD_CONSTRAINT_MIN_SCORE
	) {
		return false;
	}
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
	// Use default weights (no more weight multipliers for hard constraints)
	const weights = DEFAULT_WEIGHTS;

	const queryEmbeddings = await materialsToFieldEmbeddings(env, [material]);
	const queryEmb = queryEmbeddings[0];

	// In production, move metadata to kv or something (for now this is cheaper)
	const [ebkpResponse, nameResponse, descResponse] = await Promise.all([
		env.VECTORIZE_EBKP.query(queryEmb.ebkp, { topK, returnMetadata: "all" }),
		env.VECTORIZE_NAME.query(queryEmb.name, { topK, returnMetadata: "none" }),
		env.VECTORIZE_DESC.query(queryEmb.desc, { topK, returnMetadata: "none" }),
	]);

	// Build metadata map from ebkp response (the only one with metadata)
	const metadataMap = new Map<string, MetaData>();
	for (const match of ebkpResponse.matches) {
		metadataMap.set(match.id, match.metadata as MetaData);
	}

	// Create a map to aggregate scores by material ID
	const scoreMap = new Map<
		string,
		{
			ebkpScore: number;
			nameScore: number;
			descScore: number;
		}
	>();

	// Process ebkp matches
	for (const match of ebkpResponse.matches) {
		scoreMap.set(match.id, {
			ebkpScore: match.score,
			nameScore: 0,
			descScore: 0,
		});
	}

	// Process name matches
	for (const match of nameResponse.matches) {
		const existing = scoreMap.get(match.id);
		if (existing) {
			existing.nameScore = match.score;
		} else {
			scoreMap.set(match.id, {
				ebkpScore: 0,
				nameScore: match.score,
				descScore: 0,
			});
		}
	}

	// Process description matches
	for (const match of descResponse.matches) {
		const existing = scoreMap.get(match.id);
		if (existing) {
			existing.descScore = match.score;
		} else {
			scoreMap.set(match.id, {
				ebkpScore: 0,
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

		// Apply time filter only if availableTime constraint is "hard"
		if (
			options?.availableTime &&
			options?.constraints?.availableTime === "hard"
		) {
			const overlaps = timeRangesOverlap(
				options.availableTime.from,
				options.availableTime.to,
				metadata?.availableTime?.from,
				metadata?.availableTime?.to,
			);
			if (!overlaps) continue;
		}

		// Calculate individual scores
		const s_price = lowerIsBetterScore(material?.price, metadata?.price);
		const s_quality = lowerIsBetterScore(metadata?.quality, material?.quality);
		const s_position = distance(material?.location, metadata?.location);
		const s_size = sizeScore(material?.size, metadata?.size);

		// Build score breakdown (individual scores before weighting)
		const scoreBreakdown: ScoreBreakdown = {
			ebkp: scores.ebkpScore,
			name: scores.nameScore,
			description: scores.descScore,
			price: s_price ?? 0,
			quality: s_quality ?? 0,
			position: s_position ?? 0,
			size: s_size ?? 0,
		};

		// Filter out materials that don't pass hard constraints (< 80% match)
		if (!passesHardConstraints(scoreBreakdown, options?.constraints)) {
			continue;
		}

		// Calculate combined score using weights
		const s_combined = combinedScore([
			{ score: scores.ebkpScore, weight: weights.w_ebkp },
			{ score: scores.nameScore, weight: weights.w_name },
			{ score: scores.descScore, weight: weights.w_desc },
			{ score: s_price, weight: weights.w_price },
			{ score: s_quality, weight: weights.w_quality },
			{ score: s_position, weight: weights.w_position },
			{ score: s_size, weight: weights.w_size },
		]);

		queryMatches.push({
			materialId,
			score: s_combined,
			scoreBreakdown,
		});
	}

	// Sort by score descending and take topK
	queryMatches.sort((a, b) => b.score - a.score);
	const topMatches = queryMatches.slice(0, topK);

	return {
		matches: topMatches,
		weights,
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
		// Only EBKP vectors include metadata to avoid storage duplication
		ebkpVectors.push(
			materialToVectorizeVector(material.id, embeddings.ebkp, material),
		);
		nameVectors.push(
			materialToVectorizeVector(material.id, embeddings.name, undefined),
		);
		descVectors.push(
			materialToVectorizeVector(material.id, embeddings.desc, undefined),
		);
	});

	// TODO: Replace env.VECTORIZE with the appropriate bindings once created:
	// - env.VECTORIZE_EBKP.upsert(ebkpVectors) for ebkp embeddings (with metadata)
	// - env.VECTORIZE_NAME.upsert(nameVectors) for name embeddings
	// - env.VECTORIZE_DESC.upsert(descVectors) for description embeddings
	await Promise.all([
		env.VECTORIZE_EBKP.upsert(ebkpVectors),
		env.VECTORIZE_NAME.upsert(nameVectors),
		env.VECTORIZE_DESC.upsert(descVectors),
	]);
}
