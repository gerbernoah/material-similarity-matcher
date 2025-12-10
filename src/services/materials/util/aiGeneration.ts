import type { MaterialWithoutId } from "./types";

export type EBKPCode = {
	type: string;
	categoryCode: string;
	subCategoryCode: string;
};

/**
 * Auto-generate EBKP classification for a material using AI.
 * EBKP (Baukostenplan) is the Swiss construction cost classification system.
 */
export async function generateEBKP(
	env: Env,
	material: MaterialWithoutId,
): Promise<EBKPCode> {
	// Build a descriptive prompt for AI to classify the material
	const prompt = `You are an expert in Swiss EBKP (Baukostenplan) construction cost classification system.
Classify the following material into EBKP codes.

Material Information:
- Name: ${material.name}
${material.description ? `- Description: ${material.description}` : ""}
${material.size ? `- Dimensions: W:${material.size.width || "?"}cm x H:${material.size.height || "?"}cm x D:${material.size.depth || "?"}cm` : ""}
${material.quality !== undefined ? `- Quality: ${material.quality}` : ""}
${material.price !== undefined ? `- Price: CHF ${material.price}` : ""}

Provide the EBKP classification in the following JSON format only, no additional text:
{
  "type": "<main type, e.g., 'Building Construction', 'Interior Finishes', 'Technical Installations'>",
  "categoryCode": "<2-digit code, e.g., 'C1', 'D2', 'E3'>",
  "subCategoryCode": "<4-digit code, e.g., 'C1.1', 'D2.3', 'E3.2'>"
}`;

	try {
		const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
			messages: [
				{
					role: "system",
					content:
						"You are an expert in Swiss EBKP construction classification. Respond only with valid JSON.",
				},
				{
					role: "user",
					content: prompt,
				},
			],
		});

		if (!("response" in response) || typeof response.response !== "string") {
			throw new Error("Invalid AI response format");
		}

		// Extract JSON from response (handle potential markdown code blocks)
		let jsonText = response.response.trim();
		if (jsonText.startsWith("```json")) {
			jsonText = jsonText.replace(/```json\s*/, "").replace(/```\s*$/, "");
		} else if (jsonText.startsWith("```")) {
			jsonText = jsonText.replace(/```\s*/, "").replace(/```\s*$/, "");
		}

		const ebkpData = JSON.parse(jsonText);

		return {
			type: ebkpData.type || "General Construction",
			categoryCode: ebkpData.categoryCode || "C0",
			subCategoryCode: ebkpData.subCategoryCode || "C0.0",
		};
	} catch (error) {
		console.error("Failed to generate EBKP classification:", error);
		// Fallback to default classification
		return {
			type: "General Construction",
			categoryCode: "C0",
			subCategoryCode: "C0.0",
		};
	}
}

/**
 * Auto-generate a description for a material using AI when description is missing.
 */
export async function generateDescription(
	env: Env,
	material: MaterialWithoutId,
): Promise<string> {
	// Build a descriptive prompt for AI to generate description
	const prompt = `Generate a brief, professional 1-2 sentence description for the following construction material:

Material Name: ${material.name}
${material.size ? `Dimensions: W:${material.size.width || "?"}cm x H:${material.size.height || "?"}cm x D:${material.size.depth || "?"}cm` : ""}
${material.quality !== undefined ? `Quality/Condition: ${material.quality >= 0.9 ? "New" : material.quality >= 0.7 ? "Good" : "Okay"}` : ""}
${material.price !== undefined ? `Price: CHF ${material.price}` : ""}
${material.quantity !== undefined ? `Quantity Available: ${material.quantity}` : ""}

Provide only the description text, no additional formatting or explanations.`;

	try {
		const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
			messages: [
				{
					role: "system",
					content:
						"You are a professional construction materials expert. Generate concise, factual descriptions.",
				},
				{
					role: "user",
					content: prompt,
				},
			],
		});

		if (!("response" in response) || typeof response.response !== "string") {
			throw new Error("Invalid AI response format");
		}

		return response.response.trim();
	} catch (error) {
		console.error("Failed to generate description:", error);
		// Fallback to basic description
		return `${material.name} - construction material`;
	}
}
