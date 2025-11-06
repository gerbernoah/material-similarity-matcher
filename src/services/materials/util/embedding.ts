import type { MaterialWithoutId } from "./types";

function materialToEmbeddingText(material: MaterialWithoutId): string {
	const { ebkp, name, description } = material;

	const lines: string[] = ["Material:"];

	const add = (label: string, value?: string | number | null) => {
		if (value !== undefined && value !== null && value !== "") {
			lines.push(`- ${label}: ${value}`);
		}
	};

	add("Type", ebkp?.type);
	add("Category", ebkp?.categoryCode);
	add("Subcategory", ebkp?.subCategoryCode);
	add("Name", name);
	add("Description", description);

	return lines.join("\n");
}

export async function materialsToEmbedding(
	env: Env,
	materials: MaterialWithoutId[],
): Promise<number[][]> {
	const embeddingResponse = await env.AI.run(
		"@cf/baai/bge-base-en-v1.5",
		{
			text: materials.map((material) => materialToEmbeddingText(material)),
			pooling: "cls",
		},
		{
			gateway: {
				id: "material-similarity-embedding",
			},
		},
	);

	if (!("data" in embeddingResponse) || !embeddingResponse.data) {
		throw new Error("Embedding Response in wrong format");
	}

	return embeddingResponse.data;
}
