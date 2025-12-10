import z from "zod";

// ============================================
// BASE SCHEMAS
// ============================================

export const ebkpCodeSchema = z.object({
	type: z.string().optional(),
	categoryCode: z.string().optional(),
	subCategoryCode: z.string().optional(),
});

export const locationSchema = z.object({
	latitude: z.number(),
	longitude: z.number(),
});

export const sizeSchema = z.object({
	width: z.number().positive().optional(),
	height: z.number().positive().optional(),
	depth: z.number().positive().optional(),
});

export const availableTimeSchema = z.object({
	from: z.string().optional(), // ISO date string
	to: z.string().optional(), // ISO date string
});

// ============================================
// MATERIAL SCHEMAS
// ============================================

export const materialSchema = z.object({
	id: z.string().optional(),
	name: z.string(),
	description: z.string().optional(), // Now optional, may be auto-generated
	price: z.number().min(0).optional(), // Now optional
	quality: z.number().min(0.5).max(1).optional(), // Updated range: 0.5-1.0 only, optional for imports
	quantity: z.number().positive().optional(), // New field
	image: z.string().optional(), // URL to material image (R2)
	size: sizeSchema.optional(),
	location: locationSchema.optional(),
	ebkp: ebkpCodeSchema.optional(), // Auto-generated, not user input
	availableTime: availableTimeSchema.optional(),
});

export const materialWithIdSchema = materialSchema.extend({
	id: z.string(),
});

export const materialWithoutIdSchema = materialSchema.omit({ id: true });

// ============================================
// SCORE SCHEMAS
// ============================================

export const scoreBreakdownSchema = z.object({
	name: z.number().min(0).max(1),
	description: z.number().min(0).max(1),
	price: z.number().min(0).max(1),
	quality: z.number().min(0).max(1),
	location: z.number().min(0).max(1), // Renamed from position
	availability: z.number().min(0).max(1), // Split from position
	size: z.number().min(0).max(1),
});

export const materialWithScore = materialWithIdSchema.extend({
	score: z.number(),
	scoreBreakdown: scoreBreakdownSchema,
});

export const weightsSchema = z.object({
	w_name: z.number().min(0).max(1),
	w_desc: z.number().min(0).max(1),
	w_price: z.number().min(0).max(1),
	w_quality: z.number().min(0).max(1),
	w_location: z.number().min(0).max(1), // Split from w_position
	w_availability: z.number().min(0).max(1), // Split from w_position
	w_size: z.number().min(0).max(1),
});

// ============================================
// CONSTRAINTS SCHEMAS
// ============================================

export const constraintTypeSchema = z.enum(["hard", "soft"]);

export const searchConstraintsSchema = z.object({
	name: constraintTypeSchema.optional().default("soft"),
	description: constraintTypeSchema.optional().default("soft"),
	price: constraintTypeSchema.optional().default("soft"),
	condition: constraintTypeSchema.optional().default("soft"), // maps to quality
	location: constraintTypeSchema.optional().default("soft"),
	dimensions: constraintTypeSchema.optional().default("soft"), // maps to size
	availability: constraintTypeSchema.optional().default("soft"), // Renamed from availableTime
});

export const availableTimeRangeSchema = z.object({
	from: z.string().optional(), // ISO date string
	to: z.string().optional(), // ISO date string
});

export const locationSearchSchema = z.object({
	latitude: z.number(),
	longitude: z.number(),
	radiusKm: z.number().positive(), // Search radius in kilometers
});

// ============================================
// REQUEST SCHEMAS
// ============================================

export const addMaterialsRequestSchema = z.object({
	materials: z.array(materialWithoutIdSchema).min(1),
});

export const retrieveSimilarMaterialsRequestSchema = z.object({
	material: materialWithoutIdSchema.omit({ image: true }),
	topK: z.number().min(1).max(10).default(5),
	constraints: searchConstraintsSchema.optional(),
	location: locationSearchSchema.optional(),
	availableTime: availableTimeRangeSchema.optional(),
});
