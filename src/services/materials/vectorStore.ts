import { materialsToEmbedding } from "./util/embedding";
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
	w_alpha: 0.5,
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
	const queryVectors = await materialsToEmbedding(env, [material]);

	const queryResponse = await env.VECTORIZE.query(queryVectors[0], {
		topK,
		returnMetadata: "all",
	});

	const queryMatches = queryResponse.matches.map((match): VectorizeMatch => {
		const alpha = match.score;

		const metadata: MetaData = match.metadata as MetaData;

		const s_price = lowerIsBetterScore(material.price, metadata.price);
		const s_quality = lowerIsBetterScore(material.quality, metadata.quality);
		const s_position = distance(material.location, metadata.location);
		const s_size = sizeScore(material.size, metadata.size);

		const s_combined = combinedScore([
			{ score: alpha, weight: weights.w_alpha },
			{ score: s_price, weight: weights.w_price },
			{ score: s_quality, weight: weights.w_quality },
			{ score: s_position, weight: weights.w_position },
			{ score: s_size, weight: weights.w_size },
		]);

		return { ...match, score: s_combined };
	});

	return {
		matches: queryMatches.map(
			(match): RetrievalMatch => ({
				materialId: match.id,
				score: match.score,
			}),
		),
		weights,
	};
}

function materialToVectorizeVector(
	material: Material,
	vector: number[],
): VectorizeVector {
	const width = material.size.width;
	const height = material.size.height;
	const depth = material.size.depth;

	const metadata: MetaData = {
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

	return {
		id: `${material.id}`,
		values: vector,
		metadata,
	};
}

export async function addMaterialsToVectorStore(
	env: Env,
	materials: Material[],
) {
	const queryVectors = await materialsToEmbedding(env, materials);

	const vectors: VectorizeVector[] = [];
	queryVectors.forEach((vector, index) => {
		vectors.push(materialToVectorizeVector(materials[index], vector));
	});

	await env.VECTORIZE.upsert(vectors);
}
