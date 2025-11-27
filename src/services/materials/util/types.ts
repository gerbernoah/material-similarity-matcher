import type z from "zod";
import type {
	addMaterialsRequestSchema,
	locationSchema,
	materialSchema,
	materialWithoutIdSchema,
	retrieveSimilarMaterialsRequestSchema,
	sizeSchema,
	textualWeightsSchema,
	weightsSchema,
} from "./schemas";

export type Size = z.infer<typeof sizeSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Material = z.infer<typeof materialSchema>;
export type MaterialWithoutId = z.infer<typeof materialWithoutIdSchema>;

export type Weights = z.infer<typeof weightsSchema>;
export type TextualWeights = z.infer<typeof textualWeightsSchema>;

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
