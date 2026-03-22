enum TerrainType {
    Empty = 0,
    Ground = 1,
    Stone = 2,
    Sand = 3,
    Water = 4,
    Lava = 5,
    Grass = 6,
    Snow = 7,
    Wood = 8,
    Ice = 9,
    Ore = 10,
    Bedrock = 11,
}
enum TilePlacement {
    // ── 0 cardinal neighbours ─────────────────────────
    Single = 0,   // 0000  — isolated block, all 4 faces exposed

    // ── 1 cardinal neighbour ──────────────────────────
    CapUp = 1,   // 0001  N     — open S/E/W, connects only up
    CapRight = 2,   // 0010  E     — open N/S/W, connects only right
    CapDown = 4,   // 0100  S     — open N/E/W, connects only down
    CapLeft = 8,   // 1000  W     — open N/E/S, connects only left

    // ── 2 cardinal neighbours — pipes ─────────────────
    TunnelVertical = 5,   // 0101  N+S   — vertical tube
    TunnelHorizontal = 10,  // 1010  E+W   — horizontal tube

    // ── 2 cardinal neighbours — outer corners ─────────
    //   (two faces exposed, corner visual)
    CornerTopLeft = 6,   // 0110  E+S   — top-left corner of a solid mass
    CornerTopRight = 12,  // 1100  S+W   — top-right corner
    CornerBotLeft = 3,   // 0011  N+E   — bottom-left corner
    CornerBotRight = 9,   // 1001  N+W   — bottom-right corner

    // ── 3 cardinal neighbours — walls / T-junctions ───
    //   (one face exposed)
    EdgeTop = 14,  // 1110  E+S+W — top surface row (face-up exposed)
    EdgeBottom = 11,  // 1011  N+E+W — underside / ceiling row
    EdgeLeft = 7,   // 0111  N+E+S — left wall column
    EdgeRight = 13,  // 1101  N+S+W — right wall column

    // ── 4 cardinal neighbours — interior ──────────────
    Interior = 15,  // 1111  — fully enclosed, no cardinal face exposed

    // ── Inner corners (diagonal check on Interior cells) ──
    InnerCornerTopRight = 16,  // Interior but NE diagonal missing
    InnerCornerTopLeft = 17,  // Interior but NW diagonal missing
    InnerCornerBotRight = 18,  // Interior but SE diagonal missing
    InnerCornerBotLeft = 19,  // Interior but SW diagonal missing
}
enum WorldLayer {
    Sky = 0,  // empty, above ground surface
    Surface = 1,  // topmost solid tile in a column
    Subsurface = 2,  // 1–3 tiles below surface
    Underground = 3,  // deeper solid terrain
    Deep = 4,  // lower half of world
    Bedrock = 5,  // bottom rows
    CaveAir = 6,  // empty, enclosed within solid terrain
    CaveFloor = 7,  // solid tile directly below CaveAir
    CaveCeiling = 8,  // solid tile directly above CaveAir
    CaveWall = 9,  // solid tile adjacent to CaveAir (left/right)
    WaterSurface = 10, // water tile with air directly above
    WaterBody = 11, // water tile fully enclosed
    LavaSurface = 12,
    LavaBody = 13,
}
enum BiomeType {
    Grassland = 0,
    Desert = 1,
    Tundra = 2,
    Jungle = 3,
    Ocean = 4,
    Cave = 5,
    Volcanic = 6,
    Forest = 7,
}
namespace WorldGenEx {

    export class WorldGenMap {
        public readonly width: number;
        public readonly height: number;
        /** terrain[y][x] — TerrainType value */
        public terrain: number[][];
        /** layer[y][x]   — WorldLayer  value, built by buildLayerCache() */
        public layer: number[][];
        /** biome[y][x]   — BiomeType   value, optionally set by BiomeGen */
        public biome: number[][];

        constructor(w: number, h: number) {
            this.width = w;
            this.height = h;
            this.terrain = [];
            this.layer = [];
            this.biome = [];
            for (let y = 0; y < h; y++) {
                this.terrain.push([]);
                this.layer.push([]);
                this.biome.push([]);
                for (let x = 0; x < w; x++) {
                    this.terrain[y].push(TerrainType.Empty);
                    this.layer[y].push(WorldLayer.Sky);
                    this.biome[y].push(BiomeType.Grassland);
                }
            }
        }

        // ── Basic accessors ────────────────────────────────────────

        public inBounds(x: number, y: number): boolean {
            return x >= 0 && x < this.width && y >= 0 && y < this.height;
        }

        public get(x: number, y: number): number {
            if (!this.inBounds(x, y)) return TerrainType.Empty;
            return this.terrain[y][x];
        }

        public set(x: number, y: number, t: TerrainType): void {
            if (this.inBounds(x, y)) this.terrain[y][x] = t;
        }

        public isSolid(x: number, y: number): boolean {
            const t = this.get(x, y);
            return t !== TerrainType.Empty &&
                t !== TerrainType.Water &&
                t !== TerrainType.Lava;
        }

        public isLiquid(x: number, y: number): boolean {
            const u = this.get(x, y);
            return u === TerrainType.Water || u === TerrainType.Lava;
        }

        public isEmpty(x: number, y: number): boolean {
            return this.get(x, y) === TerrainType.Empty;
        }

        // ── Surface helpers ────────────────────────────────────────

        /** Returns the y of the first solid tile in column x, or height if none. */
        public surfaceY(x: number): number {
            for (let y2 = 0; y2 < this.height; y2++) {
                if (this.isSolid(x, y2)) return y2;
            }
            return this.height;
        }

        /** Fill a rectangle with a terrain type. */
        public fillRect(x: number, y: number, w: number, h: number, t: TerrainType): void {
            for (let dy = y; dy < y + h; dy++) {
                for (let dx = x; dx < x + w; dx++) {
                    this.set(dx, dy, t);
                }
            }
        }

        /** Count solid neighbours (cardinal + optional diagonal). */
        public solidNeighbourCount(x: number, y: number, diagonal: boolean): number {
            let count = 0;
            const dirs = diagonal
                ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
                : [[0, -1], [-1, 0], [1, 0], [0, 1]];
            for (const d of dirs) {
                if (this.isSolid(x + d[0], y + d[1])) count++;
            }
            return count;
        }

        // ── Layer cache ────────────────────────────────────────────
        /**
         * Analyses the terrain grid and populates this.layer[][].
         * Call after any generation step you want reflected in layer queries.
         */
        public buildLayerCache(): void {
            // First pass — find cave air (empty enclosed by solid)
            for (let y3 = 0; y3 < this.height; y3++) {
                for (let x2 = 0; x2 < this.width; x2++) {
                    this.layer[y3][x2] = WorldLayer.Sky; // default
                }
            }

            // Flood-fill sky from top edges
            const visited: boolean[][] = [];
            for (let y4 = 0; y4 < this.height; y4++) {
                visited.push([]);
                for (let x3 = 0; x3 < this.width; x3++) {
                    visited[y4].push(false);
                }
            }
            const queue: number[][] = [];
            for (let x4 = 0; x4 < this.width; x4++) {
                if (this.isEmpty(x4, 0)) {
                    queue.push([x4, 0]);
                    visited[0][x4] = true;
                }
            }
            while (queue.length > 0) {
                const cell = queue.removeAt(0);
                const cx = cell[0]; const cy = cell[1];
                this.layer[cy][cx] = WorldLayer.Sky;
                const dirs2 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                for (const e of dirs2) {
                    const nx = cx + e[0]; const ny = cy + e[1];
                    if (this.inBounds(nx, ny) && !visited[ny][nx] && this.isEmpty(nx, ny)) {
                        visited[ny][nx] = true;
                        queue.push([nx, ny]);
                    }
                }
            }
            // Any empty tile not reached by flood-fill → cave air
            for (let y5 = 0; y5 < this.height; y5++) {
                for (let x5 = 0; x5 < this.width; x5++) {
                    if (this.isEmpty(x5, y5) && !visited[y5][x5]) {
                        this.layer[y5][x5] = WorldLayer.CaveAir;
                    }
                }
            }
            // Liquid surface
            for (let y6 = 0; y6 < this.height; y6++) {
                for (let x6 = 0; x6 < this.width; x6++) {
                    const v = this.get(x6, y6);
                    if (v === TerrainType.Water) {
                        this.layer[y6][x6] = this.isEmpty(x6, y6 - 1)
                            ? WorldLayer.WaterSurface : WorldLayer.WaterBody;
                    } else if (v === TerrainType.Lava) {
                        this.layer[y6][x6] = this.isEmpty(x6, y6 - 1)
                            ? WorldLayer.LavaSurface : WorldLayer.LavaBody;
                    }
                }
            }
            // Second pass — classify solid tiles
            for (let y7 = 0; y7 < this.height; y7++) {
                for (let x7 = 0; x7 < this.width; x7++) {
                    if (!this.isSolid(x7, y7)) continue;
                    const surfY = this.surfaceY(x7);
                    const depth = y7 - surfY;

                    // Check adjacency to cave air
                    const aboveLayer = this.inBounds(x7, y7 - 1) ? this.layer[y7 - 1][x7] : WorldLayer.Sky;
                    const belowLayer = this.inBounds(x7, y7 + 1) ? this.layer[y7 + 1][x7] : WorldLayer.Sky;
                    const leftLayer = this.inBounds(x7 - 1, y7) ? this.layer[y7][x7 - 1] : WorldLayer.Sky;
                    const rightLayer = this.inBounds(x7 + 1, y7) ? this.layer[y7][x7 + 1] : WorldLayer.Sky;

                    const adjCave = aboveLayer === WorldLayer.CaveAir ||
                        belowLayer === WorldLayer.CaveAir ||
                        leftLayer === WorldLayer.CaveAir ||
                        rightLayer === WorldLayer.CaveAir;

                    if (adjCave) {
                        if (belowLayer === WorldLayer.CaveAir) {
                            this.layer[y7][x7] = WorldLayer.CaveCeiling;
                        } else if (aboveLayer === WorldLayer.CaveAir) {
                            this.layer[y7][x7] = WorldLayer.CaveFloor;
                        } else {
                            this.layer[y7][x7] = WorldLayer.CaveWall;
                        }
                    } else if (y7 >= this.height - 2) {
                        this.layer[y7][x7] = WorldLayer.Bedrock;
                    } else if (depth === 0) {
                        this.layer[y7][x7] = WorldLayer.Surface;
                    } else if (depth <= 3) {
                        this.layer[y7][x7] = WorldLayer.Subsurface;
                    } else if (y7 < this.height / 2) {
                        this.layer[y7][x7] = WorldLayer.Underground;
                    } else {
                        this.layer[y7][x7] = WorldLayer.Deep;
                    }
                }
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    //  BLOCKS: Map creation
    // ──────────────────────────────────────────────────────────────

    //% block="create world map width %w height %h"
    //% group="Map"
    //% w.defl=20 h.defl=15
    export function createMap(w: number, h: number): WorldGenMap {
        return new WorldGenMap(w, h);
    }

    //% block="set %map tile at x=%x y=%y to %t"
    //% group="Map"
    //% map.shadow=variables_get map.defl=map
    export function setTile(map: WorldGenMap, x: number, y: number, t: TerrainType): void {
        map.set(x, y, t);
    }

    //% block="get %map tile at x=%x y=%y"
    //% group="Map"
    //% map.shadow=variables_get map.defl=map
    export function getTile(map: WorldGenMap, x: number, y: number): number {
        return map.get(x, y);
    }

    //% block="%map is solid at x=%x y=%y"
    //% group="Map"
    //% map.shadow=variables_get map.defl=map
    export function isSolid(map: WorldGenMap, x: number, y: number): boolean {
        return map.isSolid(x, y);
    }

    //% block="build layer cache for %map"
    //% group="Map"
    //% map.shadow=variables_get map.defl=map
    export function buildLayerCache(map: WorldGenMap): void {
        map.buildLayerCache();
    }

    //% block="get layer of %map at x=%x y=%y"
    //% group="Map"
    //% map.shadow=variables_get map.defl=map
    export function getLayer(map: WorldGenMap, x: number, y: number): WorldLayer {
        return map.layer[y] ? (map.layer[y][x] || WorldLayer.Sky) : WorldLayer.Sky;
    }

    //% block="surface Y of %map at column x=%x"
    //% group="Map"
    //% map.shadow=variables_get map.defl=map
    export function getSurfaceY(map: WorldGenMap, x: number): number {
        return map.surfaceY(x);
    }

    //% block="fill %map rect x=%x y=%y w=%w h=%h with %t"
    //% group="Map"
    //% map.shadow=variables_get map.defl=map
    export function fillRect(map: WorldGenMap, x: number, y: number,
        w: number, h: number, t: TerrainType): void {
        map.fillRect(x, y, w, h, t);
    }
}
namespace TileContext {

    /**
     * Returns the TilePlacement enum for a solid cell at (x,y).
     * Checks all 8 neighbours so it can distinguish inner corners.
     * Returns TilePlacement.Single if the cell is not solid.
     */
    //% block="placement of %map at x=%x y=%y"
    //% group="Placement"
    //% map.shadow=variables_get map.defl=map
    export function getPlacement(map: WorldGenEx.WorldGenMap,
        x: number, y: number): TilePlacement {
        if (!map.isSolid(x, y)) return TilePlacement.Single;

        const N = map.isSolid(x, y - 1);
        const E = map.isSolid(x + 1, y);
        const S = map.isSolid(x, y + 1);
        const W = map.isSolid(x - 1, y);

        const mask = (N ? 1 : 0) | (E ? 2 : 0) | (S ? 4 : 0) | (W ? 8 : 0);

        // All four cardinal directions occupied — check diagonals for inner corners
        if (mask === 15) {
            const NE = map.isSolid(x + 1, y - 1);
            const NW = map.isSolid(x - 1, y - 1);
            const SE = map.isSolid(x + 1, y + 1);
            const SW = map.isSolid(x - 1, y + 1);
            // Only trigger inner-corner when exactly one diagonal is missing
            const missing = (!NE ? 1 : 0) + (!NW ? 1 : 0) + (!SE ? 1 : 0) + (!SW ? 1 : 0);
            if (missing === 1) {
                if (!NE) return TilePlacement.InnerCornerTopRight;
                if (!NW) return TilePlacement.InnerCornerTopLeft;
                if (!SE) return TilePlacement.InnerCornerBotRight;
                if (!SW) return TilePlacement.InnerCornerBotLeft;
            }
            return TilePlacement.Interior;
        }

        return mask as TilePlacement;
    }

    /** True when the cell is a cardinal surface tile (exposed top face). */
    //% block="%map is surface at x=%x y=%y"
    //% group="Context"
    //% map.shadow=variables_get map.defl=map
    export function isSurface(map: WorldGenEx.WorldGenMap,
        x: number, y: number): boolean {
        return map.isSolid(x, y) && !map.isSolid(x, y - 1);
    }

    /** True when the cell is a ceiling (exposed bottom face above empty). */
    //% block="%map is ceiling at x=%x y=%y"
    //% group="Context"
    //% map.shadow=variables_get map.defl=map
    export function isCeiling(map: WorldGenEx.WorldGenMap,
        x: number, y: number): boolean {
        return map.isSolid(x, y) && !map.isSolid(x, y + 1);
    }

    /** True when the cell is a left wall (exposed left face). */
    //% block="%map is left wall at x=%x y=%y"
    //% group="Context"
    //% map.shadow=variables_get map.defl=map
    export function isLeftWall(map: WorldGenEx.WorldGenMap,
        x: number, y: number): boolean {
        return map.isSolid(x, y) && !map.isSolid(x - 1, y);
    }

    /** True when the cell is a right wall (exposed right face). */
    //% block="%map is right wall at x=%x y=%y"
    //% group="Context"
    //% map.shadow=variables_get map.defl=map
    export function isRightWall(map: WorldGenEx.WorldGenMap,
        x: number, y: number): boolean {
        return map.isSolid(x, y) && !map.isSolid(x + 1, y);
    }

    /** True when cell is a corner (two adjacent faces exposed). */
    //% block="%map is corner at x=%x y=%y"
    //% group="Context"
    //% map.shadow=variables_get map.defl=map
    export function isCorner(map: WorldGenEx.WorldGenMap,
        x: number, y: number): boolean {
        const p = getPlacement(map, x, y);
        return p === TilePlacement.CornerTopLeft ||
            p === TilePlacement.CornerTopRight ||
            p === TilePlacement.CornerBotLeft ||
            p === TilePlacement.CornerBotRight;
    }

    /** True when cell is interior (no exposed faces). */
    //% block="%map is interior at x=%x y=%y"
    //% group="Context"
    //% map.shadow=variables_get map.defl=map
    export function isInterior(map: WorldGenEx.WorldGenMap,
        x: number, y: number): boolean {
        const q = getPlacement(map, x, y);
        return q === TilePlacement.Interior ||
            q === TilePlacement.InnerCornerTopRight ||
            q === TilePlacement.InnerCornerTopLeft ||
            q === TilePlacement.InnerCornerBotRight ||
            q === TilePlacement.InnerCornerBotLeft;
    }

    /** Count how many cardinal neighbours are solid. */
    //% block="%map solid neighbour count at x=%x y=%y"
    //% group="Context"
    //% map.shadow=variables_get map.defl=map
    export function solidNeighbours(map: WorldGenEx.WorldGenMap,
        x: number, y: number): number {
        return (map.isSolid(x, y - 1) ? 1 : 0) + (map.isSolid(x + 1, y) ? 1 : 0) +
            (map.isSolid(x, y + 1) ? 1 : 0) + (map.isSolid(x - 1, y) ? 1 : 0);
    }

    /** True if the cell is on the edge of the map. */
    //% block="%map is map-edge at x=%x y=%y"
    //% group="Context"
    //% map.shadow=variables_get map.defl=map
    export function isMapEdge(map: WorldGenEx.WorldGenMap,
        x: number, y: number): boolean {
        return x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1;
    }
}
namespace AutoTile {

    // 20 slots: 16 bitmask + 4 inner corners
    // Index = TilePlacement value  (0-15, 16-19)
    const registry: Image[] = [];

    /** Register the image to use for a particular tile placement. */
    //% block="register tile for placement %slot image %img"
    //% group="Registry"
    //% img.shadow=tileset_tile_picker
    export function register(slot: TilePlacement, img: Image): void {
        registry[slot] = img;
    }

    /**
     * Register a simple two-image tileset: one for surfaces/edges, one for interiors.
     * This is the minimum viable tileset for any terrain.
     */
    //% block="register simple tileset: surface=%surface interior=%interior"
    //% group="Registry"
    //% surface.shadow=tileset_tile_picker interior.shadow=tileset_tile_picker
    export function registerSimple(surface: Image, interior: Image): void {
        for (let i = 0; i <= 19; i++) {
            registry[i] = (i === TilePlacement.Interior ||
                i === TilePlacement.InnerCornerTopRight ||
                i === TilePlacement.InnerCornerTopLeft ||
                i === TilePlacement.InnerCornerBotRight ||
                i === TilePlacement.InnerCornerBotLeft)
                ? interior : surface;
        }
    }

    /**
     * Register a standard 5-image tileset covering the most common visual cases:
     *   topEdge, sides/bottom, corners, interior, innerCorner
     */
    //% block="register standard tileset top=%top side=%side corner=%corner interior=%interior innerCorner=%innerCorner"
    //% group="Registry"
    //% top.shadow=tileset_tile_picker      side.shadow=tileset_tile_picker
    //% corner.shadow=tileset_tile_picker   interior.shadow=tileset_tile_picker
    //% innerCorner.shadow=tileset_tile_picker
    export function registerStandard(top: Image, side: Image, corner: Image,
        interior: Image, innerCorner: Image): void {
        // Top surface (exposed top face)
        registry[TilePlacement.EdgeTop] = top;
        // Caps
        registry[TilePlacement.CapDown] = top;
        registry[TilePlacement.Single] = top;
        // Sides/bottom faces
        registry[TilePlacement.EdgeLeft] = side;
        registry[TilePlacement.EdgeRight] = side;
        registry[TilePlacement.EdgeBottom] = side;
        registry[TilePlacement.CapUp] = side;
        registry[TilePlacement.CapLeft] = side;
        registry[TilePlacement.CapRight] = side;
        registry[TilePlacement.TunnelVertical] = side;
        registry[TilePlacement.TunnelHorizontal] = side;
        // Corners
        registry[TilePlacement.CornerTopLeft] = corner;
        registry[TilePlacement.CornerTopRight] = corner;
        registry[TilePlacement.CornerBotLeft] = corner;
        registry[TilePlacement.CornerBotRight] = corner;
        // Interior
        registry[TilePlacement.Interior] = interior;
        // Inner corners
        registry[TilePlacement.InnerCornerTopRight] = innerCorner;
        registry[TilePlacement.InnerCornerTopLeft] = innerCorner;
        registry[TilePlacement.InnerCornerBotRight] = innerCorner;
        registry[TilePlacement.InnerCornerBotLeft] = innerCorner;
    }

    /** Look up the registered image for a slot, with fallback to Interior. */
    //% block="get image for placement %slot"
    //% group="Registry"
    export function getImage(slot: TilePlacement): Image {
        return registry[slot] || registry[TilePlacement.Interior];
    }

    /** Clear all registered images. */
    //% block="clear tile registry"
    //% group="Registry"
    export function clearRegistry(): void {
        for (let j = 0; j < registry.length; j++) {
            registry[j] = null as any;
        }
    }

    /**
     * Apply the registered tileset to every solid cell in the map,
     * using tiles.setTileAt() on the current scene's tilemap.
     *
     * @param map         The WorldGenMap to read
     * @param emptyImage  Image to use for empty cells (or null to skip them)
     */
    //% block="apply tileset from %map || empty tile=%emptyImage"
    //% group="Apply"
    //% map.shadow=variables_get map.defl=map
    //% emptyImage.shadow=tileset_tile_picker
    export function apply(map: WorldGenEx.WorldGenMap, emptyImage?: Image): void {
        for (let y8 = 0; y8 < map.height; y8++) {
            for (let x8 = 0; x8 < map.width; x8++) {
                if (map.isSolid(x8, y8)) {
                    const slot = TileContext.getPlacement(map, x8, y8);
                    const img = getImage(slot);
                    if (img) tiles.setTileAt(tiles.getTileLocation(x8, y8), img);
                } else if (emptyImage) {
                    tiles.setTileAt(tiles.getTileLocation(x8, y8), emptyImage);
                }
            }
        }
    }

    /**
     * Apply only within a rectangular region.
     * Useful for incrementally updating part of the map.
     */
    //% block="apply tileset from %map in region x=%rx y=%ry w=%rw h=%rh"
    //% group="Apply"
    //% map.shadow=variables_get map.defl=map
    export function applyRegion(map: WorldGenEx.WorldGenMap,
        rx: number, ry: number, rw: number, rh: number): void {
        for (let y9 = ry; y9 < ry + rh; y9++) {
            for (let x9 = rx; x9 < rx + rw; x9++) {
                if (!map.inBounds(x9, y9)) continue;
                if (map.isSolid(x9, y9)) {
                    const slot2 = TileContext.getPlacement(map, x9, y9);
                    const img2 = getImage(slot2);
                    if (img2) tiles.setTileAt(tiles.getTileLocation(x9, y9), img2);
                }
            }
        }
    }

    /**
     * Apply per-layer tile images — different images for surface, underground, etc.
     * Pass a registry object mapping WorldLayer → Image[20].
     * For layers without a custom registry, falls back to the global registry.
     */
    //% block="apply layered tileset from %map"
    //% group="Apply"
    //% map.shadow=variables_get map.defl=map
    export function applyLayered(map: WorldGenEx.WorldGenMap,
        layerRegistries: { [layer: number]: Image[] }): void {
        for (let y10 = 0; y10 < map.height; y10++) {
            for (let x10 = 0; x10 < map.width; x10++) {
                if (!map.isSolid(x10, y10)) continue;
                const slot3 = TileContext.getPlacement(map, x10, y10);
                const layer = map.layer[y10][x10];
                const imgs = layerRegistries[layer];
                const img3 = (imgs && imgs[slot3]) ? imgs[slot3] : getImage(slot3);
                if (img3) tiles.setTileAt(tiles.getTileLocation(x10, y10), img3);
            }
        }
    }
}
