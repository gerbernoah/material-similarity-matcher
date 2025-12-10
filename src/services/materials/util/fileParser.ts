import { generateDescription, generateEBKP } from "./aiGeneration";
import type { MaterialWithoutId } from "./types";

/**
 * Parse materials from file content (Excel, PDF, Word) using AI.
 * The AI extracts structured material information from unstructured data.
 */
export async function parseInventoryFile(
	env: Env,
	fileContent: string,
	fileName: string,
): Promise<MaterialWithoutId[]> {
	const fileExt = fileName.toLowerCase().split(".").pop();

	const prompt = `You are an expert at extracting construction material inventory data from documents.
Extract all materials from the following ${fileExt} file content and convert them to structured JSON format.

File Content:
${fileContent.substring(0, 15000)} ${fileContent.length > 15000 ? "... (truncated)" : ""}

For each material found, extract the following fields (use null if not found and optional):
- name: Material name (REQUIRED)
- description: Material description (optional, will be auto-generated if missing)
- price: Price in CHF (optional, number >= 0)
- quality: Quality/condition as 0.5-1.0 scale where 0.5=Okay, 0.7=Good, 1.0=New (optional)
- quantity: Quantity available (optional, number > 0)
- size: { width, height, depth } in cm (all optional)
- location: { latitude, longitude } (both optional)
- availableTime: { from: "ISO date", to: "ISO date" } (both optional)

Return ONLY a JSON array of materials, no additional text:
[
  {
    "name": "...",
    "description": "..." or null,
    "price": 123.45 or null,
    "quality": 0.8 or null,
    "quantity": 10 or null,
    "size": { "width": 100, "height": 200, "depth": 50 } or null,
    "location": { "latitude": 47.3769, "longitude": 8.5417 } or null,
    "availableTime": { "from": "2024-01-01", "to": "2024-12-31" } or null
  }
]`;

	try {
		const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
			messages: [
				{
					role: "system",
					content:
						"You are an expert at extracting structured data from documents. Respond only with valid JSON arrays.",
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

		// Extract JSON from response
		let jsonText = response.response.trim();
		if (jsonText.startsWith("```json")) {
			jsonText = jsonText.replace(/```json\s*/, "").replace(/```\s*$/, "");
		} else if (jsonText.startsWith("```")) {
			jsonText = jsonText.replace(/```\s*/, "").replace(/```\s*$/, "");
		}

		const materials = JSON.parse(jsonText);

		if (!Array.isArray(materials)) {
			throw new Error("Response is not an array");
		}

		// Process each material: generate EBKP and descriptions as needed
		const processedMaterials: MaterialWithoutId[] = await Promise.all(
			materials.map(async (mat: unknown): Promise<MaterialWithoutId> => {
				const matObj = mat as Record<string, any>;
				// Ensure required name field
				if (!matObj.name || typeof matObj.name !== "string") {
					throw new Error("Material missing required name field");
				}

				// Build material object with validated fields
				const material: MaterialWithoutId = {
					name: matObj.name,
					description: matObj.description || undefined,
					price:
						typeof matObj.price === "number" && matObj.price >= 0
							? matObj.price
							: undefined,
					quality:
						typeof matObj.quality === "number" &&
						matObj.quality >= 0.5 &&
						matObj.quality <= 1.0
							? matObj.quality
							: undefined,
					quantity:
						typeof matObj.quantity === "number" && matObj.quantity > 0
							? matObj.quantity
							: undefined,
					size:
						matObj.size &&
						(matObj.size.width || matObj.size.height || matObj.size.depth)
							? {
									width: matObj.size.width,
									height: matObj.size.height,
									depth: matObj.size.depth,
								}
							: undefined,
					location:
						matObj.location &&
						typeof matObj.location.latitude === "number" &&
						typeof matObj.location.longitude === "number"
							? {
									latitude: matObj.location.latitude,
									longitude: matObj.location.longitude,
								}
							: undefined,
					availableTime:
						matObj.availableTime &&
						(matObj.availableTime.from || matObj.availableTime.to)
							? {
									from: matObj.availableTime.from,
									to: matObj.availableTime.to,
								}
							: undefined,
				};

				// Auto-generate EBKP
				material.ebkp = await generateEBKP(env, material);

				// Auto-generate description if missing
				if (!material.description) {
					material.description = await generateDescription(env, material);
				}

				return material;
			}),
		);

		return processedMaterials;
	} catch (error) {
		console.error("Failed to parse inventory file:", error);
		throw new Error(
			`Failed to extract materials from ${fileExt} file: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Convert file buffer to text for processing.
 * For now, handles text-based formats. Binary formats like Excel/PDF need additional parsing.
 */
export async function fileToText(
	fileBuffer: ArrayBuffer,
	fileName: string,
): Promise<string> {
	const fileExt = fileName.toLowerCase().split(".").pop();

	// For text-based formats, convert directly
	if (fileExt === "txt" || fileExt === "csv") {
		return new TextDecoder().decode(fileBuffer);
	}

	// For Excel, PDF, and Word files, we would need additional libraries
	// For now, try to decode as text (this is a simplified approach)
	// In production, you'd use libraries like xlsx, pdf-parse, or mammoth
	try {
		return new TextDecoder().decode(fileBuffer);
	} catch {
		throw new Error(
			`Unsupported file format: ${fileExt}. Please use CSV, TXT, or ensure file contains readable text.`,
		);
	}
}
