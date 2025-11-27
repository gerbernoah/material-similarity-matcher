import z from "zod";

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

export const materialSchema = z.object({
	id: z.string(),
	ebkp: ebkpCodeSchema,
	name: z.string(),
	description: z.string(),
	price: z.number().min(0),
	quality: z.number().min(0).max(1),
	size: sizeSchema,
	location: locationSchema,
});

export const materialWithoutIdSchema = materialSchema.omit({ id: true });

export const materialWithScore = materialSchema.extend({
	score: z.number(),
});

export const addMaterialsRequestSchema = z.object({
	materials: z.array(materialWithoutIdSchema).min(1),
});

export const retrieveSimilarMaterialsRequestSchema = z.object({
	material: materialWithoutIdSchema,
	topK: z.number().min(1).max(10).default(5),
});

export const weightsSchema = z.object({
	w_ebkp: z.number().min(0).max(1),
	w_name: z.number().min(0).max(1),
	w_desc: z.number().min(0).max(1),
	w_price: z.number().min(0).max(1),
	w_quality: z.number().min(0).max(1),
	w_position: z.number().min(0).max(1),
	w_size: z.number().min(0).max(1),
});
