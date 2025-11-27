import { materialsToFieldEmbeddings } from "./util/embedding";
import {
	combinedScore,
	distance,
	lowerIsBetterScore,
	sizeScore,
} from "./util/retrievalScores";
import type {
	Material,
	MaterialWithoutId,
	MetaData,
	Weights,
} from "./util/types";

const weights: Weights = {
	w_ebkp: 0.3,
	w_name: 0.5,
	w_desc: 0.2,
	w_price: 0.2,
	w_quality: 0.1,
	w_position: 0.1,
	w_size: 0.1,
};

type RetrievalMatch = {
	materialId: string;
	score: number;
};
export type RetrievalResult = {
	matches: RetrievalMatch[];
	weights: Weights;
};

export async function retrieveSimilarMaterials(
	env: Env,
	topK: number,
	material: MaterialWithoutId,
): Promise<RetrievalResult> {
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

		const s_price = lowerIsBetterScore(material?.price, metadata?.price);
		const s_quality = lowerIsBetterScore(metadata?.quality, material?.quality);
		const s_position = distance(material?.location, metadata?.location);
		const s_size = sizeScore(material?.size, metadata?.size);

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

function buildMetadata(material: Material): MetaData {
	const width = material.size.width;
	const height = material.size.height;
	const depth = material.size.depth;

	return {
		quality: material.quality,
		price: material.price,
		location: {
			latitude: material.location.latitude,
			longitude: material.location.longitude,
		},
		size: {
			...(width && { width }),
			...(height && { height }),
			...(depth && { depth }),
		},
	};
}

function materialToVectorizeVector(
	id: string,
	vector: number[],
	meta?: Material,
): VectorizeVector {
	return {
		id,
		values: vector,
		...(meta && { metadata: buildMetadata(meta) }),
	};
}

export async function addMaterialsToVectorStore(
	env: Env,
	materials: Material[],
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
