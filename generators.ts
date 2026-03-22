/**
 * WorldGenEx — Generation Algorithms
 *
 * Namespaces:
 *   WorldGen    — fill/generate the terrain grid
 *   BiomeGen    — assign biome + layered material rules
 *   RoomGen     — procedural dungeon / room-and-corridor generation
 *   NoiseUtil   — internal noise helpers (not exposed as blocks)
 */

// ═══════════════════════════════════════════════════════════════════
//  INTERNAL NOISE UTILITIES (not exported as blocks)
// ═══════════════════════════════════════════════════════════════════

namespace NoiseUtil {

    /** Deterministic integer hash → float 0–1. */
    export function hash(x: number, y: number, seed: number): number {
        let h = seed ^ 0x9e3779b9;
        h ^= (x * 374761393) | 0;
        h ^= (y * 668265263) | 0;
        h = (h + (h << 13)) | 0;
        h ^= (h >> 7);
        h = (h + (h << 3)) | 0;
        h ^= (h >> 17);
        h = (h + (h << 5)) | 0;
        return (h & 0x7fffffff) / 0x7fffffff;
    }

    /** Smooth step 3t²−2t³ for value interpolation. */
    function smooth(t: number): number {
        return t * t * (3 - 2 * t);
    }

    /** Bilinear-interpolated value noise, scale controls feature size. */
    export function valueNoise(x: number, y: number, scale: number, seed: number): number {
        const nx = x / scale;
        const ny = y / scale;
        const ix = Math.floor(nx);
        const iy = Math.floor(ny);
        const fx = nx - ix;
        const fy = ny - iy;
        const ux = smooth(fx);
        const uy = smooth(fy);
        const a = hash(ix, iy, seed);
        const b = hash(ix + 1, iy, seed);
        const c = hash(ix, iy + 1, seed);
        const d = hash(ix + 1, iy + 1, seed);
        return a + (b - a) * ux + (c - a) * uy + (d - b - c + a) * ux * uy;
    }

    /**
     * Fractal Brownian Motion — layered octaves of value noise.
     * octaves: number of layers (more = more detail)
     * lacunarity: frequency multiplier per octave (typically 2)
     * persistence: amplitude multiplier per octave (typically 0.5)
     */
    export function fbm(x: number, y: number, scale: number, seed: number,
        octaves: number, lacunarity: number, persistence: number): number {
        let value = 0;
        let amp = 1;
        let freq = 1;
        let max = 0;
        for (let i = 0; i < octaves; i++) {
            value += valueNoise(x * freq, y * freq, scale, seed + i * 7919) * amp;
            max += amp;
            amp *= persistence;
            freq *= lacunarity;
        }
        return value / max;
    }
}

// ═══════════════════════════════════════════════════════════════════
//  WORLD GEN — terrain generation algorithms
// ═══════════════════════════════════════════════════════════════════

//% block="World Generator"
//% color="#27AE60"
//% icon="\uf6fc"
namespace WorldGen {

    // ── Helpers ───────────────────────────────────────────────────

    function rng(seed: number): () => number {
        let s = seed ^ 0xdeadbeef;
        return () => {
            s ^= s << 13; s ^= s >> 17; s ^= s << 5;
            return (s & 0x7fffffff) / 0x7fffffff;
        };
    }

    // ─────────────────────────────────────────────────────────────
    //  1. SOLID FILL / CLEAR
    // ─────────────────────────────────────────────────────────────

    //% block="fill %map entirely with %t"
    //% group="Basic"
    //% map.shadow=variables_get map.defl=map
    export function fillAll(map: WorldGenEx.WorldGenMap, t: TerrainType): void {
        map.fillRect(0, 0, map.width, map.height, t);
    }

    //% block="clear %map (all empty)"
    //% group="Basic"
    //% map.shadow=variables_get map.defl=map
    export function clearAll(map: WorldGenEx.WorldGenMap): void {
        fillAll(map, TerrainType.Empty);
    }

    //% block="fill solid border on %map thickness=%thickness with %t"
    //% group="Basic"
    //% map.shadow=variables_get map.defl=map
    //% thickness.defl=1
    export function fillBorder(map: WorldGenEx.WorldGenMap,
        thickness: number, t: TerrainType): void {
        for (let k = 0; k < thickness; k++) {
            for (let x = 0; x < map.width; x++) {
                map.set(x, k, t);
                map.set(x, map.height - 1 - k, t);
            }
            for (let y = 0; y < map.height; y++) {
                map.set(k, y, t);
                map.set(map.width - 1 - k, y, t);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  2. HEIGHTMAP — flat terrain with surface + underground layers
    // ─────────────────────────────────────────────────────────────

    /**
     * Generates side-scrolling terrain.
     *
     * @param map         Target map
     * @param seed        Random seed
     * @param surfaceY    Baseline surface row (0 = top)
     * @param amplitude   Max height variation in tiles
     * @param noiseScale  Feature size (higher = smoother hills)
     * @param surface     Terrain type for the surface row
     * @param subsurface  Type for 1–subsurfaceDepth rows below surface
     * @param underground Type for everything deeper
     * @param bedrock     Type for the bottom 2 rows (or 0 for none)
     */
    //% block="heightmap %map seed=%seed surfaceY=%sy amplitude=%amp scale=%scale || surface=%s sub=%ss underground=%u bedrock=%b subDepth=%sd"
    //% group="Heightmap"
    //% map.shadow=variables_get map.defl=map
    //% seed.defl=42  sy.defl=8  amp.defl=3  scale.defl=5
    //% s.defl=TerrainType.Grass  ss.defl=TerrainType.Ground
    //% u.defl=TerrainType.Stone  b.defl=TerrainType.Bedrock  sd.defl=3
    //% expandableArgumentMode="toggle"
    export function heightmap(
        map: WorldGenEx.WorldGenMap,
        seed: number,
        surfaceY: number,
        amplitude: number,
        noiseScale: number,
        surface: TerrainType = TerrainType.Grass,
        subsurface: TerrainType = TerrainType.Ground,
        underground: TerrainType = TerrainType.Stone,
        bedrock: TerrainType = TerrainType.Bedrock,
        subsurfaceDepth: number = 3
    ): void {
        for (let x = 0; x < map.width; x++) {
            const noise = NoiseUtil.fbm(x, 0, noiseScale, seed, 3, 2, 0.5);
            const sy = Math.round(surfaceY + (noise * 2 - 1) * amplitude);

            for (let y = 0; y < map.height; y++) {
                if (y < sy) {
                    map.set(x, y, TerrainType.Empty);
                } else if (y === sy) {
                    map.set(x, y, surface);
                } else if (y <= sy + subsurfaceDepth) {
                    map.set(x, y, subsurface);
                } else if (y >= map.height - 2 && bedrock !== TerrainType.Empty) {
                    map.set(x, y, bedrock);
                } else {
                    map.set(x, y, underground);
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  3. CELLULAR AUTOMATA — organic cave shapes
    // ─────────────────────────────────────────────────────────────

    /**
     * Randomly fills the map then smooths it into cave shapes.
     *
     * @param density     Initial fill % of solid tiles (40–55 gives good caves)
     * @param passes      Smoothing iterations (4–6 recommended)
     * @param birthLimit  A cell is born solid when ≥ birthLimit solid neighbours
     * @param deathLimit  A solid cell dies when < deathLimit solid neighbours
     */
    //% block="cave automata %map seed=%seed density=%density passes=%passes || birth=%bl death=%dl terrain=%t"
    //% group="Cave"
    //% map.shadow=variables_get map.defl=map
    //% seed.defl=42  density.defl=45  passes.defl=5  bl.defl=5  dl.defl=4
    //% t.defl=TerrainType.Stone
    //% expandableArgumentMode="toggle"
    export function cave(
        map: WorldGenEx.WorldGenMap,
        seed: number,
        density: number,
        passes: number,
        birthLimit: number = 5,
        deathLimit: number = 4,
        terrain: TerrainType = TerrainType.Stone
    ): void {
        const next = rng(seed);
        // Initial random fill
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                if (x === 0 || y === 0 ||
                    x === map.width - 1 || y === map.height - 1) {
                    map.set(x, y, terrain); // always solid border
                } else {
                    map.set(x, y, next() * 100 < density ? terrain : TerrainType.Empty);
                }
            }
        }
        // Smoothing passes
        for (let pass = 0; pass < passes; pass++) {
            // Build next state into a fresh array
            const newState: number[][] = [];
            for (let y = 0; y < map.height; y++) {
                newState.push([]);
                for (let x = 0; x < map.width; x++) {
                    const n = map.solidNeighbourCount(x, y, false);
                    if (map.isSolid(x, y)) {
                        newState[y].push(n >= deathLimit ? terrain : TerrainType.Empty);
                    } else {
                        newState[y].push(n > birthLimit ? terrain : TerrainType.Empty);
                    }
                }
            }
            for (let y = 0; y < map.height; y++) {
                for (let x = 0; x < map.width; x++) {
                    map.terrain[y][x] = newState[y][x];
                }
            }
        }
    }

    /**
     * One manual cellular automata pass — use inside a loop for custom control.
     */
    //% block="automata pass on %map birthLimit=%bl deathLimit=%dl terrain=%t"
    //% group="Cave"
    //% map.shadow=variables_get map.defl=map
    //% bl.defl=5 dl.defl=4  t.defl=TerrainType.Stone
    export function automataPass(map: WorldGenEx.WorldGenMap,
        birthLimit: number, deathLimit: number,
        terrain: TerrainType): void {
        const snap: number[][] = [];
        for (let y = 0; y < map.height; y++) {
            snap.push(map.terrain[y].slice());
        }
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                const n = map.solidNeighbourCount(x, y, false);
                if (snap[y][x] !== TerrainType.Empty) {
                    map.terrain[y][x] = n >= deathLimit ? terrain : TerrainType.Empty;
                } else {
                    map.terrain[y][x] = n > birthLimit ? terrain : TerrainType.Empty;
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  4. DRUNKARD WALK — winding tunnels
    // ─────────────────────────────────────────────────────────────

    /**
     * Carves tunnels by a randomly-walking agent.
     *
     * @param startX/startY  Start position of the walker
     * @param steps          How many steps to take
     * @param width          Tunnel width (1 = single-tile, 2 = 2×2, etc.)
     * @param bias           Cardinal direction bias 0–1 (0=truly random, 1=straight)
     * @param biasDir        0=Right 1=Down 2=Left 3=Up
     */
    //% block="drunk walk %map seed=%seed steps=%steps from x=%sx y=%sy width=%w || bias=%bias biasDir=%bd"
    //% group="Cave"
    //% map.shadow=variables_get map.defl=map
    //% seed.defl=42  steps.defl=200  sx.defl=2  sy.defl=7  w.defl=2
    //% bias.defl=0.2  bd.defl=0
    //% expandableArgumentMode="toggle"
    export function drunkWalk(
        map: WorldGenEx.WorldGenMap,
        seed: number,
        steps: number,
        startX: number, startY: number,
        width: number = 1,
        bias: number = 0,
        biasDir: number = 0
    ): void {
        const next = rng(seed);
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        let cx = Math.max(0, Math.min(map.width - 1, startX));
        let cy = Math.max(0, Math.min(map.height - 1, startY));

        for (let i = 0; i < steps; i++) {
            // Carve a width×width square
            for (let dy = 0; dy < width; dy++) {
                for (let dx = 0; dx < width; dx++) {
                    map.set(cx + dx, cy + dy, TerrainType.Empty);
                }
            }
            // Choose next direction
            let dir: number[];
            if (next() < bias) {
                dir = dirs[biasDir & 3];
            } else {
                dir = dirs[Math.floor(next() * 4)];
            }
            cx = Math.max(0, Math.min(map.width - width, cx + dir[0]));
            cy = Math.max(0, Math.min(map.height - width, cy + dir[1]));
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  5. NOISE SCATTER — ore veins, random details
    // ─────────────────────────────────────────────────────────────

    /**
     * Scatter a replacement terrain type wherever the noise is above a threshold.
     * Good for ore pockets, grass patches, snow on peaks, etc.
     */
    //% block="scatter %replacement in %map where noise>%threshold scale=%scale seed=%seed only inside %host"
    //% group="Detail"
    //% map.shadow=variables_get map.defl=map
    //% replacement.defl=TerrainType.Ore  host.defl=TerrainType.Stone
    //% threshold.defl=0.7  scale.defl=3  seed.defl=99
    export function noiseScatter(
        map: WorldGenEx.WorldGenMap,
        replacement: TerrainType,
        threshold: number,
        scale: number,
        seed: number,
        host: TerrainType = TerrainType.Stone
    ): void {
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                if (map.get(x, y) !== host) continue;
                const n = NoiseUtil.fbm(x, y, scale, seed, 2, 2, 0.5);
                if (n > threshold) map.set(x, y, replacement);
            }
        }
    }

    /**
     * Randomly scatter a terrain type within a host, by percentage chance.
     */
    //% block="random scatter %replacement in %map chance=%pct % inside %host seed=%seed"
    //% group="Detail"
    //% map.shadow=variables_get map.defl=map
    //% replacement.defl=TerrainType.Ore  host.defl=TerrainType.Stone
    //% pct.defl=5  seed.defl=77
    export function randomScatter(
        map: WorldGenEx.WorldGenMap,
        replacement: TerrainType,
        pct: number,
        host: TerrainType,
        seed: number
    ): void {
        const next = rng(seed);
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                if (map.get(x, y) === host && next() * 100 < pct) {
                    map.set(x, y, replacement);
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  6. ISLAND — circular/elliptical landmass
    // ─────────────────────────────────────────────────────────────

    /**
     * Carves out an island shape from a filled map.
     * The map should be pre-filled before calling this.
     */
    //% block="carve island on %map seed=%seed radius=%r noiseStr=%ns || ocean=%ocean"
    //% group="Island"
    //% map.shadow=variables_get map.defl=map
    //% seed.defl=42  r.defl=0.45  ns.defl=0.15  ocean.defl=TerrainType.Water
    //% expandableArgumentMode="toggle"
    export function island(
        map: WorldGenEx.WorldGenMap,
        seed: number,
        radius: number = 0.45,
        noiseFalloff: number = 0.15,
        ocean: TerrainType = TerrainType.Water
    ): void {
        const cx = map.width / 2;
        const cy = map.height / 2;
        const maxDist = Math.min(map.width, map.height) / 2;
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                if (!map.isSolid(x, y)) continue;
                const dx = (x - cx) / maxDist;
                const dy = (y - cy) / maxDist;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const noise = NoiseUtil.valueNoise(x, y, 3, seed) * noiseFalloff;
                if (dist > radius + noise) {
                    map.set(x, y, ocean);
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  7. COMBINE — merge two maps
    // ─────────────────────────────────────────────────────────────

    //% block="overlay %src onto %dst (non-empty overwrites)"
    //% group="Combine"
    //% dst.shadow=variables_get dst.defl=map
    //% src.shadow=variables_get src.defl=src
    export function overlay(dst: WorldGenEx.WorldGenMap,
        src: WorldGenEx.WorldGenMap): void {
        const w = Math.min(dst.width, src.width);
        const h = Math.min(dst.height, src.height);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!src.isEmpty(x, y)) dst.set(x, y, src.get(x, y));
            }
        }
    }

    //% block="intersect solid: keep solid in %dst only where %mask is also solid"
    //% group="Combine"
    //% dst.shadow=variables_get dst.defl=map
    //% mask.shadow=variables_get mask.defl=mask
    export function intersect(dst: WorldGenEx.WorldGenMap,
        mask: WorldGenEx.WorldGenMap): void {
        const w = Math.min(dst.width, mask.width);
        const h = Math.min(dst.height, mask.height);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!mask.isSolid(x, y)) dst.set(x, y, TerrainType.Empty);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  8. SURFACE DETAIL — add decorative surface features
    // ─────────────────────────────────────────────────────────────

    /**
     * Place a terrain type on the first empty cell above each surface tile.
     * Great for grass tips, snow caps, tree bases, etc.
     */
    //% block="place surface detail %t on %map chance=%pct % seed=%seed"
    //% group="Detail"
    //% map.shadow=variables_get map.defl=map
    //% t.defl=TerrainType.Grass  pct.defl=100  seed.defl=1
    export function surfaceDetail(map: WorldGenEx.WorldGenMap, t: TerrainType,
        pct: number, seed: number): void {
        const next = rng(seed);
        for (let x = 0; x < map.width; x++) {
            const sy = map.surfaceY(x);
            if (sy > 0 && next() * 100 < pct) {
                map.set(x, sy - 1, t);
            }
        }
    }

    /**
     * Fill air columns from the surface down to replace with liquid (water table).
     */
    //% block="water table on %map at row %waterY with %liquid"
    //% group="Detail"
    //% map.shadow=variables_get map.defl=map
    //% waterY.defl=10  liquid.defl=TerrainType.Water
    export function waterTable(map: WorldGenEx.WorldGenMap,
        waterY: number,
        liquid: TerrainType = TerrainType.Water): void {
        for (let y = waterY; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                if (map.isEmpty(x, y)) map.set(x, y, liquid);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  9. COPY / MIRROR / ROTATE
    // ─────────────────────────────────────────────────────────────

    //% block="mirror %map horizontally"
    //% group="Transform"
    //% map.shadow=variables_get map.defl=map
    export function mirrorH(map: WorldGenEx.WorldGenMap): void {
        const hw = Math.floor(map.width / 2);
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < hw; x++) {
                map.set(map.width - 1 - x, y, map.get(x, y));
            }
        }
    }

    //% block="mirror %map vertically"
    //% group="Transform"
    //% map.shadow=variables_get map.defl=map
    export function mirrorV(map: WorldGenEx.WorldGenMap): void {
        const hh = Math.floor(map.height / 2);
        for (let y = 0; y < hh; y++) {
            for (let x = 0; x < map.width; x++) {
                map.set(x, map.height - 1 - y, map.get(x, y));
            }
        }
    }

    //% block="invert solid/empty in %map"
    //% group="Transform"
    //% map.shadow=variables_get map.defl=map
    export function invert(map: WorldGenEx.WorldGenMap,
        solidType: TerrainType = TerrainType.Stone): void {
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                if (map.isSolid(x, y)) map.set(x, y, TerrainType.Empty);
                else map.set(x, y, solidType);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  BIOME GEN — assign biomes and swap terrain types by layer/biome
// ═══════════════════════════════════════════════════════════════════

//% block="Biome Generator"
//% color="#8E44AD"
//% icon="\uf0ac"
namespace BiomeGen {

    /**
     * Assign biomes using two noise channels (height + moisture).
     * Biome[] parameter: 8 biomes corresponding to 2×2×2 buckets:
     *   Index = (lowHumidity?0:1)*4 + (midHeight?0:1)*2 + (cold?0:1)
     *   Indices 0–7 → [Grassland, Desert, Tundra, Jungle, Ocean, Cave, Volcanic, Forest]
     *
     * For simple use, call assignSimpleBiomes instead.
     */
    //% block="assign biomes to %map heightScale=%hs moistureScale=%ms seed=%seed"
    //% group="Biome"
    //% map.shadow=variables_get map.defl=map
    //% hs.defl=6  ms.defl=8  seed.defl=42
    export function assignBiomes(map: WorldGenEx.WorldGenMap,
        heightScale: number,
        moistureScale: number,
        seed: number): void {
        for (let x = 0; x < map.width; x++) {
            const surfY = map.surfaceY(x);
            const height = 1 - surfY / map.height; // 0=deep, 1=high elevation
            const moist = NoiseUtil.valueNoise(x, 0, moistureScale, seed + 31337);
            let biome: BiomeType;
            if (height > 0.75) {
                biome = moist > 0.5 ? BiomeType.Jungle : BiomeType.Tundra;
            } else if (height > 0.35) {
                biome = moist > 0.5 ? BiomeType.Forest : BiomeType.Grassland;
            } else {
                biome = moist > 0.5 ? BiomeType.Jungle : BiomeType.Desert;
            }
            for (let y = 0; y < map.height; y++) {
                map.biome[y][x] = biome;
            }
        }
    }

    /**
     * Replace terrain types based on the cell's layer, allowing
     * easy per-layer material changes (e.g. snow on surface in tundra).
     *
     * @param layer        WorldLayer to target
     * @param from         Terrain type to replace
     * @param to           Terrain type to place
     */
    //% block="replace layer %layer in %map: %from → %to"
    //% group="Layer Material"
    //% map.shadow=variables_get map.defl=map
    //% from.defl=TerrainType.Ground  to.defl=TerrainType.Snow
    export function replaceInLayer(map: WorldGenEx.WorldGenMap,
        layer: WorldLayer,
        from: TerrainType,
        to: TerrainType): void {
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                if (map.layer[y][x] === layer && map.get(x, y) === from) {
                    map.set(x, y, to);
                }
            }
        }
    }

    /**
     * Replace terrain between two depth rows (inclusive).
     * Great for ore bands, lava pockets at depth, etc.
     */
    //% block="replace %from with %to in %map between rows %y1 and %y2"
    //% group="Layer Material"
    //% map.shadow=variables_get map.defl=map
    //% from.defl=TerrainType.Stone  to.defl=TerrainType.Lava
    export function replaceInDepthBand(map: WorldGenEx.WorldGenMap,
        from: TerrainType,
        to: TerrainType,
        y1: number,
        y2: number): void {
        for (let y = Math.max(0, y1); y <= Math.min(map.height - 1, y2); y++) {
            for (let x = 0; x < map.width; x++) {
                if (map.get(x, y) === from) map.set(x, y, to);
            }
        }
    }

    /**
     * Auto-apply biome-appropriate surface materials.
     * Requires biomes to have been assigned (assignBiomes) and
     * layer cache built (buildLayerCache).
     *
     * Mapping used:
     *   Grassland surface → Grass
     *   Desert surface    → Sand
     *   Tundra  surface   → Snow
     *   Volcanic deep     → Lava
     */
    //% block="apply biome surface materials to %map"
    //% group="Biome"
    //% map.shadow=variables_get map.defl=map
    export function applyBiomeMaterials(map: WorldGenEx.WorldGenMap): void {
        for (let y = 0; y < map.height; y++) {
            for (let x = 0; x < map.width; x++) {
                if (map.layer[y][x] !== WorldLayer.Surface) continue;
                const b = map.biome[y][x] as BiomeType;
                switch (b) {
                    case BiomeType.Grassland:
                    case BiomeType.Forest: map.set(x, y, TerrainType.Grass); break;
                    case BiomeType.Desert: map.set(x, y, TerrainType.Sand); break;
                    case BiomeType.Tundra: map.set(x, y, TerrainType.Snow); break;
                    case BiomeType.Ocean: map.set(x, y, TerrainType.Water); break;
                    case BiomeType.Volcanic: map.set(x, y, TerrainType.Lava); break;
                }
            }
        }
    }

    //% block="get biome of %map at x=%x y=%y"
    //% group="Biome"
    //% map.shadow=variables_get map.defl=map
    export function getBiome(map: WorldGenEx.WorldGenMap,
        x: number, y: number): BiomeType {
        if (!map.inBounds(x, y)) return BiomeType.Grassland;
        return map.biome[y][x] as BiomeType;
    }
}

// ═══════════════════════════════════════════════════════════════════
//  ROOM GEN — procedural dungeon / room-and-corridor generation
// ═══════════════════════════════════════════════════════════════════

//% block="Room Generator"
//% color="#E67E22"
//% icon="\uf0f8"
namespace RoomGen {

    export class Room {
        public x: number;
        public y: number;
        public w: number;
        public h: number;
        constructor(x: number, y: number, w: number, h: number) {
            this.x = x; this.y = y; this.w = w; this.h = h;
        }
        public centerX(): number { return Math.floor(this.x + this.w / 2); }
        public centerY(): number { return Math.floor(this.y + this.h / 2); }
        public overlaps(other: Room, margin: number): boolean {
            return this.x - margin < other.x + other.w + margin &&
                this.x + this.w + margin > other.x - margin &&
                this.y - margin < other.y + other.h + margin &&
                this.y + this.h + margin > other.y - margin;
        }
    }

    /** Carves a single room (empty rectangle) into the map. */
    //% block="carve room at x=%x y=%y w=%w h=%h in %map"
    //% group="Rooms"
    //% map.shadow=variables_get map.defl=map
    export function carveRoom(map: WorldGenEx.WorldGenMap,
        x: number, y: number, w: number, h: number): void {
        map.fillRect(x, y, w, h, TerrainType.Empty);
    }

    /**
     * Scatter random rooms in a pre-filled map and connect them with corridors.
     *
     * @param attempts     How many rooms to try placing
     * @param minSize      Min room dimension
     * @param maxSize      Max room dimension
     * @param margin       Min gap between rooms
     * @returns            Array of placed Room objects (useful for spawning enemies/items)
     */
    //% block="scatter rooms in %map seed=%seed attempts=%att minSize=%mn maxSize=%mx || margin=%mg corridor=%ct"
    //% group="Rooms"
    //% map.shadow=variables_get map.defl=map
    //% seed.defl=42  att.defl=20  mn.defl=3  mx.defl=6  mg.defl=1
    //% ct.defl=TerrainType.Ground
    //% expandableArgumentMode="toggle"
    export function scatterRooms(
        map: WorldGenEx.WorldGenMap,
        seed: number,
        attempts: number,
        minSize: number,
        maxSize: number,
        margin: number = 1,
        corridorType: TerrainType = TerrainType.Ground
    ): Room[] {
        const next = _rng(seed);
        const rooms: Room[] = [];

        for (let i = 0; i < attempts; i++) {
            const rw = minSize + Math.floor(next() * (maxSize - minSize + 1));
            const rh = minSize + Math.floor(next() * (maxSize - minSize + 1));
            const rx = 1 + Math.floor(next() * (map.width - rw - 2));
            const ry = 1 + Math.floor(next() * (map.height - rh - 2));
            const candidate = new Room(rx, ry, rw, rh);

            let overlaps = false;
            for (const existing of rooms) {
                if (candidate.overlaps(existing, margin)) { overlaps = true; break; }
            }
            if (!overlaps) {
                carveRoom(map, rx, ry, rw, rh);
                rooms.push(candidate);
            }
        }

        // Connect rooms with L-shaped corridors in placement order
        for (let i = 1; i < rooms.length; i++) {
            const prev = rooms[i - 1];
            const curr = rooms[i];
            _carveCorridor(map, prev.centerX(), prev.centerY(),
                curr.centerX(), curr.centerY(),
                corridorType, next() > 0.5);
        }
        return rooms;
    }

    /**
     * Carve an L-shaped corridor between two points.
     */
    //% block="carve corridor %map from (%x1,%y1) to (%x2,%y2) terrain=%t hFirst=%hf"
    //% group="Corridors"
    //% map.shadow=variables_get map.defl=map
    //% t.defl=TerrainType.Ground  hf.defl=true
    export function carveCorridor(map: WorldGenEx.WorldGenMap,
        x1: number, y1: number,
        x2: number, y2: number,
        t: TerrainType = TerrainType.Ground,
        hFirst: boolean = true): void {
        _carveCorridor(map, x1, y1, x2, y2, t, hFirst);
    }

    function _carveCorridor(map: WorldGenEx.WorldGenMap,
        x1: number, y1: number,
        x2: number, y2: number,
        t: TerrainType, hFirst: boolean): void {
        if (hFirst) {
            _carveHLine(map, x1, x2, y1, t);
            _carveVLine(map, y1, y2, x2, t);
        } else {
            _carveVLine(map, y1, y2, x1, t);
            _carveHLine(map, x1, x2, y2, t);
        }
    }

    function _carveHLine(map: WorldGenEx.WorldGenMap,
        x1: number, x2: number, y: number, t: TerrainType): void {
        const lo = Math.min(x1, x2); const hi = Math.max(x1, x2);
        for (let x = lo; x <= hi; x++) map.set(x, y, t);
    }

    function _carveVLine(map: WorldGenEx.WorldGenMap,
        y1: number, y2: number, x: number, t: TerrainType): void {
        const lo = Math.min(y1, y2); const hi = Math.max(y1, y2);
        for (let y = lo; y <= hi; y++) map.set(x, y, t);
    }

    /** Returns the center x of a room. */
    //% block="room center x of %room"
    //% group="Rooms"
    //% room.shadow=variables_get room.defl=room
    export function roomCenterX(room: Room): number { return room.centerX(); }

    /** Returns the center y of a room. */
    //% block="room center y of %room"
    //% group="Rooms"
    //% room.shadow=variables_get room.defl=room
    export function roomCenterY(room: Room): number { return room.centerY(); }

    function _rng(seed: number): () => number {
        let s = seed ^ 0xdeadbeef;
        return () => {
            s ^= s << 13; s ^= s >> 17; s ^= s << 5;
            return (s & 0x7fffffff) / 0x7fffffff;
        };
    }
}