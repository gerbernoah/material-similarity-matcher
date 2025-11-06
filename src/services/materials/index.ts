import type { ZodSafeParseError } from "zod";
import type { Service } from "..";
import { authenticateToken } from "../auth";
import {
	addMaterialsRequestSchema,
	retrieveSimilarMaterialsRequestSchema,
} from "./util/schemas";
import type {
	AddMaterialsRequest,
	Material,
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

		if (!authContext.access) {
			return new Response("Access denied", { status: 403 });
		}

		switch (`${request.method} /${subPath.split("/")[0]}`) {
			case "POST /add": {
				const payload = await request.json<AddMaterialsRequest>();
				const parsedPayload = addMaterialsRequestSchema.safeParse(payload);

				if (!parsedPayload.success) {
					return zodErrorToResponse(parsedPayload);
				}

				const materials: Material[] = parsedPayload.data.materials.map(
					(materialWithoutId): Material => ({
						...materialWithoutId,
						id: crypto.randomUUID(),
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
				);

				const materialsPromise: Promise<Material | null>[] = [];
				retrievalResult.matches.forEach((match) => {
					materialsPromise.push(
						env.DATA_KV.get(`${MATERIALS_KV_PREFIX}/${match.materialId}`, {
							type: "json",
						}),
					);
				});

				const materials = (await Promise.all(materialsPromise)).filter(
					(material) => material !== null,
				);

				return Response.json(
					{
						error: false,
						message: "Retrieval Successful",
						data: materials,
					},
					{ status: 200 },
				);
			}
		}
	},
};
