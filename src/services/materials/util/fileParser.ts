import { generateDescription, generateEBKP } from "./aiGeneration";
import type { MaterialWithoutId } from "./types";

/**
 * Type guard helper to safely access object properties
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
				const matObj = mat as Record<string, unknown>;
				// Ensure required name field
				if (!matObj.name || typeof matObj.name !== "string") {
					throw new Error("Material missing required name field");
				}

				// Build material object with validated fields
				const material: MaterialWithoutId = {
					name: matObj.name,
					description:
						typeof matObj.description === "string"
							? matObj.description
							: undefined,
					price:
						typeof matObj.price === "number" && matObj.price >= 0
							? matObj.price
							: undefined,
					quality:
						typeof matObj.quality === "number" &&
						matObj.quality >= 0 &&
						matObj.quality <= 1.0
							? matObj.quality
							: undefined,
					quantity:
						typeof matObj.quantity === "number" && matObj.quantity > 0
							? matObj.quantity
							: undefined,
					size:
						isRecord(matObj.size) &&
						(typeof matObj.size.width === "number" ||
							typeof matObj.size.height === "number" ||
							typeof matObj.size.depth === "number")
							? {
									width:
										typeof matObj.size.width === "number"
											? matObj.size.width
											: undefined,
									height:
										typeof matObj.size.height === "number"
											? matObj.size.height
											: undefined,
									depth:
										typeof matObj.size.depth === "number"
											? matObj.size.depth
											: undefined,
								}
							: undefined,
					location:
						isRecord(matObj.location) &&
						typeof matObj.location.latitude === "number" &&
						typeof matObj.location.longitude === "number"
							? {
									latitude: matObj.location.latitude,
									longitude: matObj.location.longitude,
								}
							: undefined,
					availableTime:
						isRecord(matObj.availableTime) &&
						(typeof matObj.availableTime.from === "string" ||
							typeof matObj.availableTime.to === "string")
							? {
									from:
										typeof matObj.availableTime.from === "string"
											? matObj.availableTime.from
											: undefined,
									to:
										typeof matObj.availableTime.to === "string"
											? matObj.availableTime.to
											: undefined,
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
 * Parse CSV file with AI-based flexible extraction.
 * The AI intelligently interprets various CSV structures without requiring specific column names.
 */
export async function parseCSVFile(
	env: Env,
	csvContent: string,
): Promise<MaterialWithoutId[]> {
	const prompt = `You are a material data extraction assistant. Extract material information from the following CSV content and return a JSON array of materials.

Rules:
1. Be flexible with column names - interpret variations (e.g., "Material", "Item", "Product" all mean name)
2. Handle any CSV structure - don't require specific headers or column order
3. Use smart defaults: quality=0.5 if not specified
4. Skip rows that don't contain material information (headers, notes, totals, empty rows, etc.)
5. Return empty array if no materials found
6. CRITICAL: You MUST respond with ONLY a JSON array. Do NOT include any explanatory text, greetings, or comments.

For each material, extract these properties (extract what's available, use intelligent defaults for missing data):
- name (required): Material name or title
- description (optional): Description or details about the material
- price (optional): Price in CHF, extract numbers only
- quality (optional): Condition from 0 (very bad) to 1.0 (new). Map keywords:
  - "new", "brand new", "unused" → 1.0
  - "excellent", "like new" → 0.9
  - "good" → 0.75
  - "fair", "okay", "used" → 0.5
  - "poor", "damaged", "very bad" → 0.25
- quantity (optional): Available quantity, extract numbers
- image (optional): Image URL if present
- size (optional): Extract dimensions in centimeters
  - width, height, depth
  - Convert from mm (divide by 10), cm (no change), m (multiply by 100), or other units
- location (optional): Geographic coordinates
  - latitude, longitude
  - If only address/city is given, try to geocode it (e.g., "Zurich" → lat: 47.37, lon: 8.54)

CSV content:
${csvContent.substring(0, 15000)}${csvContent.length > 15000 ? "... (truncated)" : ""}

IMPORTANT: Return ONLY a JSON array with no other text. Example format:
[{"name":"Wood Beam","description":"Oak beam","price":150,"quality":0.75,"quantity":5}]

If no materials found, return: []`;

	try {
		const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
			messages: [
				{
					role: "system",
					content:
						"You are a data extraction assistant. You MUST respond with ONLY valid JSON arrays. Never include explanatory text, never start with phrases like 'I don't see' or 'Here is'. Only output JSON.",
				},
				{
					role: "user",
					content: prompt,
				},
			],
			max_tokens: 4096,
		});

		if (!("response" in response) || typeof response.response !== "string") {
			throw new Error("Invalid AI response format");
		}

		// Extract JSON from response - handle various formats
		let jsonText = response.response.trim();

		// Remove markdown code blocks
		if (jsonText.startsWith("```json")) {
			jsonText = jsonText.replace(/```json\s*/, "").replace(/```\s*$/, "");
		} else if (jsonText.startsWith("```")) {
			jsonText = jsonText.replace(/```\s*/, "").replace(/```\s*$/, "");
		}

		// Try to find JSON array in the response if AI added extra text
		const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
		if (arrayMatch) {
			jsonText = arrayMatch[0];
		}

		let materials: unknown;
		try {
			materials = JSON.parse(jsonText);
		} catch {
			// If JSON parsing fails, return empty array instead of throwing
			console.warn(
				"Failed to parse AI response as JSON:",
				jsonText.substring(0, 200),
			);
			return [];
		}

		if (!Array.isArray(materials)) {
			console.warn("AI response is not an array:", typeof materials);
			return [];
		}

		// Process each material: validate and generate EBKP/descriptions
		const processedMaterials: MaterialWithoutId[] = await Promise.all(
			materials.map(async (mat: unknown): Promise<MaterialWithoutId> => {
				const matObj = mat as Record<string, unknown>;

				// Ensure required name field
				if (!matObj.name || typeof matObj.name !== "string") {
					throw new Error("Material missing required name field");
				}

				// Build material object with validated fields
				const material: MaterialWithoutId = {
					name: matObj.name,
					description:
						typeof matObj.description === "string"
							? matObj.description
							: undefined,
					price:
						typeof matObj.price === "number" && matObj.price >= 0
							? matObj.price
							: undefined,
					quality:
						typeof matObj.quality === "number" &&
						matObj.quality >= 0 &&
						matObj.quality <= 1.0
							? matObj.quality
							: 0.5, // Default to 0.5 as specified
					quantity:
						typeof matObj.quantity === "number" && matObj.quantity > 0
							? matObj.quantity
							: undefined,
					size:
						isRecord(matObj.size) &&
						(typeof matObj.size.width === "number" ||
							typeof matObj.size.height === "number" ||
							typeof matObj.size.depth === "number")
							? {
									width:
										typeof matObj.size.width === "number"
											? matObj.size.width
											: undefined,
									height:
										typeof matObj.size.height === "number"
											? matObj.size.height
											: undefined,
									depth:
										typeof matObj.size.depth === "number"
											? matObj.size.depth
											: undefined,
								}
							: undefined,
					location:
						isRecord(matObj.location) &&
						typeof matObj.location.latitude === "number" &&
						typeof matObj.location.longitude === "number"
							? {
									latitude: matObj.location.latitude,
									longitude: matObj.location.longitude,
								}
							: undefined,
					availableTime:
						isRecord(matObj.availableTime) &&
						(typeof matObj.availableTime.from === "string" ||
							typeof matObj.availableTime.to === "string")
							? {
									from:
										typeof matObj.availableTime.from === "string"
											? matObj.availableTime.from
											: undefined,
									to:
										typeof matObj.availableTime.to === "string"
											? matObj.availableTime.to
											: undefined,
								}
							: undefined,
				};

				// Auto-generate EBKP classification
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
		console.error("Failed to parse CSV file:", error);
		throw new Error(
			`Failed to parse document: ${error instanceof Error ? error.message : "Unknown error"}`,
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
