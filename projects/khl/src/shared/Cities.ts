/**
 * Cities that KHL arenas are in, keyed by a slug that includes the state so
 * names like "Kent" stay unambiguous. Arenas.ts refers to cities by this id,
 * and the client uses it for filtering and display.
 */
export interface City {
	name: string
	/** Two-letter postal abbreviation */
	state: string
	/** Fixed color per city so the same area always reads the same */
	color: string
}

export const CITIES = {
	"seattle-wa": {name: "Seattle", state: "WA", color: "#2563eb"},
	"kent-wa": {name: "Kent", state: "WA", color: "#7c3aed"},
	"renton-wa": {name: "Renton", state: "WA", color: "#dc2626"},
	"kirkland-wa": {name: "Kirkland", state: "WA", color: "#ea580c"},
	"mountlake-terrace-wa": {
		name: "Mountlake Terrace",
		state: "WA",
		color: "#0d9488",
	},
	"lynnwood-wa": {name: "Lynnwood", state: "WA", color: "#0284c7"},
	"everett-wa": {name: "Everett", state: "WA", color: "#16a34a"},
	"shoreline-wa": {name: "Shoreline", state: "WA", color: "#ca8a04"},
	"tacoma-wa": {name: "Tacoma", state: "WA", color: "#db2777"},
	"winthrop-wa": {name: "Winthrop", state: "WA", color: "#65a30d"},
	"palm-desert-ca": {name: "Palm Desert", state: "CA", color: "#a16207"},
} as const satisfies Record<string, City>

export type CityId = keyof typeof CITIES

export function getCity(id: string): City | undefined {
	return Object.hasOwn(CITIES, id) ? CITIES[id as CityId] : undefined
}
