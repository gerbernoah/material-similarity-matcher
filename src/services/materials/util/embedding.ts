import type { MaterialWithoutId } from "./types";

/**
 * Represents the embeddings for different textual fields of a material.
 * Each field has its own embedding vector for weighted similarity scoring.
 */
export type MaterialEmbeddings = {
	ebkp: number[];
	name: number[];
	desc: number[];
};

function materialToEbkpText(material: MaterialWithoutId): string {
	const { ebkp } = material;
	const parts: string[] = [];

	if (ebkp?.type) parts.push(`Type: ${ebkp.type}`);
	if (ebkp?.categoryCode) parts.push(`Category: ${ebkp.categoryCode}`);
	if (ebkp?.subCategoryCode) parts.push(`Subcategory: ${ebkp.subCategoryCode}`);

	return parts.length > 0 ? parts.join("\n") : "No classification";
}

function materialToNameText(material: MaterialWithoutId): string {
	return material.name || "Unnamed material";
}

function materialToDescriptionText(material: MaterialWithoutId): string {
	return material.description || "No description";
}

async function generateEmbeddings(
	env: Env,
	texts: string[],
): Promise<number[][]> {
	const embeddingResponse = await env.AI.run(
		"@cf/baai/bge-base-en-v1.5",
		{
			text: texts,
			pooling: "cls",
		},
		{
			gateway: {
				id: "material-hub",
			},
		},
	);

	if (!("data" in embeddingResponse) || !embeddingResponse.data) {
		throw new Error("Embedding Response in wrong format");
	}

	return embeddingResponse.data;
}

/**
 * Generate separate embeddings for each textual field of materials.
 * Returns an array of MaterialEmbeddings, one per input material.
 */
export async function materialsToFieldEmbeddings(
	env: Env,
	materials: MaterialWithoutId[],
): Promise<MaterialEmbeddings[]> {
	// Prepare texts for each field
	const ebkpTexts = materials.map(materialToEbkpText);
	const nameTexts = materials.map(materialToNameText);
	const descriptionTexts = materials.map(materialToDescriptionText);

	// Generate all embeddings in parallel
	const [ebkpEmbeddings, nameEmbeddings, descriptionEmbeddings] =
		await Promise.all([
			generateEmbeddings(env, ebkpTexts),
			generateEmbeddings(env, nameTexts),
			generateEmbeddings(env, descriptionTexts),
		]);

	// Combine into per-material embeddings
	return materials.map((_, index) => ({
		ebkp: ebkpEmbeddings[index],
		name: nameEmbeddings[index],
		desc: descriptionEmbeddings[index],
	}));
}
