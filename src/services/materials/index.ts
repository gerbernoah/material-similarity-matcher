import type { ZodSafeParseError } from "zod";
import type { Service } from "..";
import { ACCOUNT_KV_PREFIX, type AccountKV, authenticateToken } from "../auth";
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

				const materials: MaterialWithId[] = parsedPayload.data.materials.map(
					(materialWithoutId): MaterialWithId => ({
						...materialWithoutId,
						id: crypto.randomUUID(),
						// TODO: Handle image upload to R2
						// If materialWithoutId.image contains base64 data:
						// 1. Upload to R2: await env.R2_BUCKET.put(`images/${id}`, imageData)
						// 2. Store the R2 URL/key in the material
					}),
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
		}
	},
};
