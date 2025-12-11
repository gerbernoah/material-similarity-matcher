import type { ZodSafeParseError } from "zod";
import type { Service } from "..";
import { ACCOUNT_KV_PREFIX, type AccountKV, authenticateToken } from "../auth";
import { generateDescription, generateEBKP } from "./util/aiGeneration";
import {
	fileToText,
	parseCSVFile,
	parseInventoryFile,
} from "./util/fileParser";
import {
	addMaterialsRequestSchema,
	retrieveSimilarMaterialsRequestSchema,
} from "./util/schemas";
import type {
	AddMaterialsRequest,
	MaterialWithId,
	MaterialWithScore,
	RetrieveSimilarMaterialsRequest,
} from "./util/types";
import {
	addMaterialsToVectorStore,
	retrieveSimilarMaterials,
} from "./vectorStore";

const MATERIALS_KV_PREFIX = "materials";

function zodErrorToResponse(result: ZodSafeParseError<unknown>): Response {
	return Response.json(
		{
			error: true,
			message: result.error,
		},
		{ status: 400 },
	);
}

export const service: Service = {
	path: "/v1/materials/",
	fetch: async (
		request: Request,
		env: Env,
		_ctx: ExecutionContext,
		subPath: string,
	): Promise<Response | undefined> => {
		const authContext = await authenticateToken(request.headers, env);

		if (authContext instanceof Response) {
			return authContext;
		}

		const author: AccountKV | null = await env.DATA_KV.get(
			`${ACCOUNT_KV_PREFIX}/${encodeURIComponent(authContext.username)}`,
			"json",
		);

		if (!author || !author.access) {
			return new Response("Access denied", { status: 403 });
		}

		switch (`${request.method} /${subPath.split("/")[0]}`) {
			case "POST /add": {
				const payload = await request.json<AddMaterialsRequest>();
				const parsedPayload = addMaterialsRequestSchema.safeParse(payload);

				if (!parsedPayload.success) {
					return zodErrorToResponse(parsedPayload);
				}

				// Process materials: generate EBKP and optionally descriptions
				const materials: MaterialWithId[] = await Promise.all(
					parsedPayload.data.materials.map(
						async (materialWithoutId): Promise<MaterialWithId> => {
							const id = crypto.randomUUID();

							// Auto-generate EBKP classification
							const ebkp = await generateEBKP(env, materialWithoutId);

							// Auto-generate description if missing
							const description =
								materialWithoutId.description ||
								(await generateDescription(env, materialWithoutId));

							return {
								...materialWithoutId,
								id,
								ebkp,
								description,
								// TODO: Handle image upload to R2
								// If materialWithoutId.image contains base64 data:
								// 1. Upload to R2: await env.R2_BUCKET.put(`images/${id}`, imageData)
								// 2. Store the R2 URL/key in the material
							};
						},
					),
				);

				await addMaterialsToVectorStore(env, materials);

				const kvPutPromises: Promise<void>[] = [];
				materials.forEach((material) => {
					kvPutPromises.push(
						env.DATA_KV.put(
							`${MATERIALS_KV_PREFIX}/${material.id}`,
							JSON.stringify(material),
						),
					);
				});

				await Promise.all(kvPutPromises);

				return Response.json(
					{
						error: false,
						message: "Materials Added",
					},
					{ status: 200 },
				);
			}
			case "POST /import": {
				try {
					const contentType = request.headers.get("content-type") || "";

					if (!contentType.includes("multipart/form-data")) {
						return Response.json(
							{
								error: true,
								message: "Request must be multipart/form-data with a file",
							},
							{ status: 400 },
						);
					}

					// Parse form data
					const formData = await request.formData();
					const file = formData.get("file") as File | null;

					if (!file) {
						return Response.json(
							{
								error: true,
								message: "No file provided",
							},
							{ status: 400 },
						);
					}

					// Validate file type (CSV only)
					const fileName = file.name.toLowerCase();
					if (!fileName.endsWith(".csv")) {
						return Response.json(
							{
								error: true,
								message: "Only CSV files are supported",
							},
							{ status: 400 },
						);
					}

					// Validate file size (10MB max for CSV)
					const maxSize = 10 * 1024 * 1024; // 10MB
					if (file.size > maxSize) {
						return Response.json(
							{
								error: true,
								message: "File size exceeds 10MB limit",
							},
							{ status: 400 },
						);
					}

					// Read CSV content
					const fileBuffer = await file.arrayBuffer();
					const csvContent = new TextDecoder().decode(fileBuffer);

					// Parse materials from CSV using AI
					const parsedMaterials = await parseCSVFile(env, csvContent);

					if (parsedMaterials.length === 0) {
						return Response.json(
							{
								count: 0,
								message: "No materials found in the CSV file",
							},
							{ status: 200 },
						);
					}

					// Convert to MaterialWithId and store
					const materials: MaterialWithId[] = parsedMaterials.map((mat) => ({
						...mat,
						id: crypto.randomUUID(),
					}));

					// Add to vector store
					await addMaterialsToVectorStore(env, materials);

					// Store in KV
					const kvPutPromises: Promise<void>[] = materials.map((material) =>
						env.DATA_KV.put(
							`${MATERIALS_KV_PREFIX}/${material.id}`,
							JSON.stringify(material),
						),
					);

					await Promise.all(kvPutPromises);

					return Response.json(
						{
							count: materials.length,
							message: `Successfully imported ${materials.length} materials`,
						},
						{ status: 200 },
					);
				} catch (error) {
					console.error("CSV import error:", error);
					return Response.json(
						{
							error: true,
							message:
								error instanceof Error
									? `Failed to parse document: ${error.message}`
									: "Failed to import CSV",
						},
						{ status: 500 },
					);
				}
			}
			case "POST /retrieve": {
				const payload = await request.json<RetrieveSimilarMaterialsRequest>();
				const parsedPayload =
					retrieveSimilarMaterialsRequestSchema.safeParse(payload);

				if (!parsedPayload.success) {
					return zodErrorToResponse(parsedPayload);
				}

				const retrievalResult = await retrieveSimilarMaterials(
					env,
					parsedPayload.data.topK,
					parsedPayload.data.material,
					{
						constraints: parsedPayload.data.constraints,
						location: parsedPayload.data.location,
						availableTime: parsedPayload.data.availableTime,
						weights: parsedPayload.data.weights,
					},
				);

				const materialsWithScores: (MaterialWithScore | null)[] =
					await Promise.all(
						retrievalResult.matches.map(
							async (match): Promise<MaterialWithScore | null> => {
								const material = await env.DATA_KV.get<MaterialWithId>(
									`${MATERIALS_KV_PREFIX}/${match.materialId}`,
									{ type: "json" },
								);
								if (!material) return null;

								// TODO: Generate signed URL for image from R2
								// If material.image contains R2 key:
								// const imageUrl = await env.R2_BUCKET.createSignedUrl(material.image)
								// Or use a public URL if bucket is public

								return {
									...material,
									score: match.score,
									scoreBreakdown: match.scoreBreakdown,
								};
							},
						),
					);

				const materials: MaterialWithScore[] = materialsWithScores.filter(
					(material) => material !== null,
				);

				return Response.json(
					{
						error: false,
						message: `Found ${materials.length} similar materials`,
						data: {
							materials,
							weights: retrievalResult.weights,
						},
					},
					{ status: 200 },
				);
			}
			case "POST /import-inventory": {
				try {
					const contentType = request.headers.get("content-type") || "";

					if (!contentType.includes("multipart/form-data")) {
						return Response.json(
							{
								error: true,
								message: "Request must be multipart/form-data with a file",
							},
							{ status: 400 },
						);
					}

					// Parse form data
					const formData = await request.formData();
					const file = formData.get("file") as File | null;

					if (!file) {
						return Response.json(
							{
								error: true,
								message:
									"No file provided. Include a 'file' field in the form data.",
							},
							{ status: 400 },
						);
					}

					// Validate file type
					const fileName = file.name.toLowerCase();
					const validExtensions = [
						".xlsx",
						".xls",
						".pdf",
						".docx",
						".txt",
						".csv",
					];
					const hasValidExtension = validExtensions.some((ext) =>
						fileName.endsWith(ext),
					);

					if (!hasValidExtension) {
						return Response.json(
							{
								error: true,
								message: `Unsupported file type. Supported formats: ${validExtensions.join(", ")}`,
							},
							{ status: 400 },
						);
					}

					// Read file content
					const fileBuffer = await file.arrayBuffer();
					const fileText = await fileToText(fileBuffer, file.name);

					// Parse materials from file using AI
					const parsedMaterials = await parseInventoryFile(
						env,
						fileText,
						file.name,
					);

					if (parsedMaterials.length === 0) {
						return Response.json(
							{
								error: true,
								message: "No materials found in the file",
							},
							{ status: 400 },
						);
					}

					// Convert to MaterialWithId and store
					const materials: MaterialWithId[] = parsedMaterials.map((mat) => ({
						...mat,
						id: crypto.randomUUID(),
					}));

					// Add to vector store
					await addMaterialsToVectorStore(env, materials);

					// Store in KV
					const kvPutPromises: Promise<void>[] = materials.map((material) =>
						env.DATA_KV.put(
							`${MATERIALS_KV_PREFIX}/${material.id}`,
							JSON.stringify(material),
						),
					);

					await Promise.all(kvPutPromises);

					return Response.json(
						{
							error: false,
							message: "Inventory imported successfully",
							count: materials.length,
						},
						{ status: 200 },
					);
				} catch (error) {
					console.error("Import inventory error:", error);
					return Response.json(
						{
							error: true,
							message:
								error instanceof Error
									? error.message
									: "Failed to import inventory",
						},
						{ status: 500 },
					);
				}
			}
		}
	},
};
