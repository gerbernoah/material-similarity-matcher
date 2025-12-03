import type z from "zod";
import type {
	addMaterialsRequestSchema,
	availableTimeRangeSchema,
	availableTimeSchema,
	constraintTypeSchema,
	locationSchema,
	locationSearchSchema,
	materialSchema,
	materialWithIdSchema,
	materialWithoutIdSchema,
	materialWithScore,
	retrieveSimilarMaterialsRequestSchema,
	scoreBreakdownSchema,
	searchConstraintsSchema,
	sizeSchema,
	weightsSchema,
} from "./schemas";

// ============================================
// BASE TYPES
// ============================================

export type Size = z.infer<typeof sizeSchema>;
export type Location = z.infer<typeof locationSchema>;
export type AvailableTime = z.infer<typeof availableTimeSchema>;

// ============================================
// MATERIAL TYPES
// ============================================

export type Material = z.infer<typeof materialSchema>;
export type MaterialWithId = z.infer<typeof materialWithIdSchema>;
export type MaterialWithoutId = z.infer<typeof materialWithoutIdSchema>;

// ============================================
// SCORE TYPES
// ============================================

export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type MaterialWithScore = z.infer<typeof materialWithScore>;
export type Weights = z.infer<typeof weightsSchema>;

// ============================================
// CONSTRAINTS TYPES
// ============================================

export type ConstraintType = z.infer<typeof constraintTypeSchema>;
export type SearchConstraints = z.infer<typeof searchConstraintsSchema>;
export type AvailableTimeRange = z.infer<typeof availableTimeRangeSchema>;
export type LocationSearch = z.infer<typeof locationSearchSchema>;

// ============================================
// METADATA TYPES
// ============================================

export type MetaData = {
	quality: number;
	price: number;
	location?: Location;
	size?: Size;
	availableTime?: AvailableTime;
};

// ============================================
// REQUEST/RESPONSE TYPES
// ============================================

export type AddMaterialsRequest = z.infer<typeof addMaterialsRequestSchema>;
export type RetrieveSimilarMaterialsRequest = z.infer<
	typeof retrieveSimilarMaterialsRequestSchema
>;

export type MaterialsRetrieveResponse = {
	error: boolean;
	message: string;
	data: {
		materials: MaterialWithScore[];
		weights: Weights;
	};
};
