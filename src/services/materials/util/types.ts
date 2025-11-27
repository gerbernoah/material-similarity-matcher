import type z from "zod";
import type {
	addMaterialsRequestSchema,
	locationSchema,
	materialSchema,
	materialWithoutIdSchema,
	materialWithScore,
	retrieveSimilarMaterialsRequestSchema,
	sizeSchema,
	weightsSchema,
} from "./schemas";

export type Size = z.infer<typeof sizeSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Material = z.infer<typeof materialSchema>;
export type MaterialWithoutId = z.infer<typeof materialWithoutIdSchema>;
export type MaterialWithScore = z.infer<typeof materialWithScore>;

export type Weights = z.infer<typeof weightsSchema>;

export type MetaData = {
	quality: number;
	price: number;
	location: Location;
	size: Size;
};

export type AddMaterialsRequest = z.infer<typeof addMaterialsRequestSchema>;
export type RetrieveSimilarMaterialsRequest = z.infer<
	typeof retrieveSimilarMaterialsRequestSchema
>;
