import {z} from "zod"

export interface LiveBarnNamedEntity {
	id: number
	name: string
}

export const LiveBarnNamedEntitySchema = z.object({
	id: z.number(),
	name: z.string(),
}) satisfies z.ZodType<LiveBarnNamedEntity>

export interface LiveBarnProvince {
	id: number
	name: string
	country: LiveBarnNamedEntity
}

export const LiveBarnProvinceSchema = z.object({
	id: z.number(),
	name: z.string(),
	country: LiveBarnNamedEntitySchema,
}) satisfies z.ZodType<LiveBarnProvince>

export interface LiveBarnFirstMedia {
	surfaceUuid: string
	firstMediaDate: number
}

export const LiveBarnFirstMediaSchema = z.object({
	surfaceUuid: z.string(),
	firstMediaDate: z.number(),
}) satisfies z.ZodType<LiveBarnFirstMedia>

export interface LiveBarnRendition {
	id: number
	name: string
	width: number
	height: number
	ratio: string
	bitrate: number
}

export const LiveBarnRenditionSchema = z.object({
	id: z.number(),
	name: z.string(),
	width: z.number(),
	height: z.number(),
	ratio: z.string(),
	bitrate: z.number(),
}) satisfies z.ZodType<LiveBarnRendition>

export interface LiveBarnSurface {
	id: number
	name: string
	online: boolean
	uuid: string
	venueId: number
	comingSoon: boolean
	closedFrom: number | null
	orderIndex: number
	surfaceStatus: LiveBarnNamedEntity
	sports: LiveBarnNamedEntity[]
	feedModes: LiveBarnNamedEntity[]
	firstMedia: LiveBarnFirstMedia | null
	renditions: LiveBarnRendition[]
}

export const LiveBarnSurfaceSchema = z.object({
	id: z.number(),
	name: z.string(),
	online: z.boolean(),
	uuid: z.string(),
	venueId: z.number(),
	comingSoon: z.boolean(),
	closedFrom: z.number().nullable(),
	orderIndex: z.number(),
	surfaceStatus: LiveBarnNamedEntitySchema,
	sports: z.array(LiveBarnNamedEntitySchema),
	feedModes: z.array(LiveBarnNamedEntitySchema),
	firstMedia: LiveBarnFirstMediaSchema.nullable(),
	renditions: z.array(LiveBarnRenditionSchema),
}) satisfies z.ZodType<LiveBarnSurface>

export interface LiveBarnVenue {
	id: number
	uuid: string
	name: string
	address1: string
	address2: string | null
	city: string
	postalCode: string
	province: LiveBarnProvince
	longitude: number
	latitude: number
	recordingHoursLocal: string
	allSheetsCount: number
	logoUrl: {"100": string; "240": string}
	venueStatus: LiveBarnNamedEntity
	surfaces: LiveBarnSurface[]
	zoneIds: LiveBarnNamedEntity
}

export const LiveBarnVenueSchema = z.object({
	id: z.number(),
	uuid: z.string(),
	name: z.string(),
	address1: z.string(),
	address2: z.string().nullable(),
	city: z.string(),
	postalCode: z.string(),
	province: LiveBarnProvinceSchema,
	longitude: z.number(),
	latitude: z.number(),
	recordingHoursLocal: z.string(),
	allSheetsCount: z.number(),
	logoUrl: z.object({"100": z.string(), "240": z.string()}),
	venueStatus: LiveBarnNamedEntitySchema,
	surfaces: z.array(LiveBarnSurfaceSchema),
	zoneIds: LiveBarnNamedEntitySchema,
}) satisfies z.ZodType<LiveBarnVenue>

export type LiveBarnVenuesResponse = LiveBarnVenue[]

export const LiveBarnVenuesResponseSchema = z.array(
	LiveBarnVenueSchema,
) satisfies z.ZodType<LiveBarnVenuesResponse>
