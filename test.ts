// tests go here; this will not be compiled when this package is used as an extension.
/**
 * WorldGenEx Usage Examples
 *
 * Copy any of these into your MakeCode Arcade project to get started.
 * Each example assumes you have added the extension from its GitHub URL.
 */

// ─────────────────────────────────────────────────────────────────
//  EXAMPLE 1 — Simple side-scrolling platformer world
// ─────────────────────────────────────────────────────────────────
function example_platformer(): void {
    const map = WorldGenEx.createMap(20, 15);

    // Generate rolling hills
    WorldGen.heightmap(map, 42, 7, 3, 5,
        TerrainType.Grass,    // surface row gets grass
        TerrainType.Ground,   // 1–3 rows below surface get dirt
        TerrainType.Stone,    // everything deeper gets stone
        TerrainType.Bedrock,  // bottom 2 rows get bedrock
        3                     // subsurface depth
    );

    // Add ore veins deep underground
    WorldGen.noiseScatter(map, TerrainType.Ore, 0.75, 3, 99, TerrainType.Stone);

    // Build the layer data (needed for per-layer tile sets)
    WorldGenEx.buildLayerCache(map);

    // Register tile images
    AutoTile.register(TilePlacement.EdgeTop, assets.tile`grassSurface`);
    AutoTile.register(TilePlacement.CornerTopLeft, assets.tile`grassCornerTL`);
    AutoTile.register(TilePlacement.CornerTopRight, assets.tile`grassCornerTR`);
    AutoTile.register(TilePlacement.CornerBotLeft, assets.tile`dirtCornerBL`);
    AutoTile.register(TilePlacement.CornerBotRight, assets.tile`dirtCornerBR`);
    AutoTile.register(TilePlacement.EdgeLeft, assets.tile`dirtSideLeft`);
    AutoTile.register(TilePlacement.EdgeRight, assets.tile`dirtSideRight`);
    AutoTile.register(TilePlacement.EdgeBottom, assets.tile`dirtBottom`);
    AutoTile.register(TilePlacement.Interior, assets.tile`dirtFill`);
    AutoTile.register(TilePlacement.InnerCornerTopRight, assets.tile`dirtInnerTR`);
    AutoTile.register(TilePlacement.InnerCornerTopLeft, assets.tile`dirtInnerTL`);

    // Paint the tilemap
    AutoTile.apply(map, assets.tile`sky`);
}

// ─────────────────────────────────────────────────────────────────
//  EXAMPLE 2 — Cave crawler (cellular automata)
// ─────────────────────────────────────────────────────────────────
function example_cave(): void {
    const map = WorldGenEx.createMap(30, 20);

    // Fill the whole map with stone first
    WorldGen.fillAll(map, TerrainType.Stone);

    // Carve caves using cellular automata (45% density, 5 passes)
    WorldGen.cave(map, 1234, 45, 5, 5, 4, TerrainType.Stone);

    // Ensure solid border
    WorldGen.fillBorder(map, 1, TerrainType.Stone);

    // Carve some additional winding tunnels
    WorldGen.drunkWalk(map, 999, 100, 5, 10, 2, 0.3, 0 /* rightward bias */);

    // Build layer cache
    WorldGenEx.buildLayerCache(map);

    // Use a simple two-image set for quick testing
    AutoTile.registerSimple(assets.tile`stoneEdge`, assets.tile`stoneFill`);
    AutoTile.apply(map, assets.tile`caveAir`);
}

// ─────────────────────────────────────────────────────────────────
//  EXAMPLE 3 — Dungeon with rooms and corridors
// ─────────────────────────────────────────────────────────────────
function example_dungeon(): void {
    const map = WorldGenEx.createMap(30, 20);

    // Start fully solid
    WorldGen.fillAll(map, TerrainType.Stone);

    // Scatter rooms and connect them
    const rooms = RoomGen.scatterRooms(
        map,
        42,       // seed
        20,       // max attempts
        3, 6,     // min/max room size
        1,        // margin between rooms
        TerrainType.Ground  // corridor fill type
    );

    // Build layer cache
    WorldGenEx.buildLayerCache(map);

    // Register tiles (minimal — use registerStandard for a complete look)
    AutoTile.register(TilePlacement.EdgeTop, assets.tile`stoneTop`);
    AutoTile.register(TilePlacement.Interior, assets.tile`stoneFill`);
    AutoTile.register(TilePlacement.CornerTopLeft, assets.tile`stoneCornerTL`);
    AutoTile.register(TilePlacement.CornerTopRight, assets.tile`stoneCornerTR`);
    AutoTile.register(TilePlacement.EdgeLeft, assets.tile`stoneSideL`);
    AutoTile.register(TilePlacement.EdgeRight, assets.tile`stoneSideR`);

    AutoTile.apply(map, assets.tile`floor`);

    // Spawn player in center of first room
    if (rooms.length > 0) {
        scene.cameraFollowSprite(sprites.create(assets.image`hero`, SpriteKind.Player));
        const player = sprites.allOfKind(SpriteKind.Player)[0];
        player.setPosition(
            RoomGen.roomCenterX(rooms[0]) * 16 + 8,
            RoomGen.roomCenterY(rooms[0]) * 16 + 8
        );
    }
}

// ─────────────────────────────────────────────────────────────────
//  EXAMPLE 4 — Biome world with layered tile sets
// ─────────────────────────────────────────────────────────────────
function example_biome_world(): void {
    const map = WorldGenEx.createMap(30, 18);

    // Base heightmap
    WorldGen.heightmap(map, 77, 7, 4, 6,
        TerrainType.Grass, TerrainType.Ground, TerrainType.Stone,
        TerrainType.Bedrock, 3);

    // Assign biomes and build layer cache
    BiomeGen.assignBiomes(map, 6, 8, 77);
    WorldGenEx.buildLayerCache(map);

    // Let the biome engine swap surface tiles to the correct material
    BiomeGen.applyBiomeMaterials(map);

    // Add a water table halfway down
    WorldGen.waterTable(map, 12, TerrainType.Water);

    // Register a five-image standard set per material
    AutoTile.register(TilePlacement.EdgeTop, assets.tile`surfaceAuto`);
    AutoTile.register(TilePlacement.Interior, assets.tile`underAuto`);
    AutoTile.register(TilePlacement.CornerTopLeft, assets.tile`cornerTLAuto`);
    AutoTile.register(TilePlacement.CornerTopRight, assets.tile`cornerTRAuto`);

    AutoTile.apply(map, assets.tile`sky`);
}

// ─────────────────────────────────────────────────────────────────
//  EXAMPLE 5 — Reading tile context at runtime (e.g. for physics)
// ─────────────────────────────────────────────────────────────────
function example_context_queries(map: WorldGenEx.WorldGenMap): void {
    // Check what kind of tile is at (5, 8)
    const placement = TileContext.getPlacement(map, 5, 8);
    if (placement === TilePlacement.EdgeTop) {
        // This is a walkable surface tile — spawn a platform decoration
    }
    if (placement === TilePlacement.CornerTopLeft ||
        placement === TilePlacement.CornerTopRight) {
        // This is a corner — place a vine or edge ornament
    }

    // Layer-based queries (requires buildLayerCache first)
    const layer = WorldGenEx.getLayer(map, 5, 8);
    if (layer === WorldLayer.CaveFloor) {
        // Underground cave floor — spawn a torch
    }
    if (layer === WorldLayer.Surface) {
        // The top surface — spawn grass decoration
    }
    if (layer === WorldLayer.Deep) {
        // Very deep — spawn dangerous enemies or rare ore
    }

    // Convenience context checks
    if (TileContext.isSurface(map, 5, 8)) {
        // Confirmed walkable surface (no solid tile above)
    }
    if (TileContext.isCorner(map, 5, 8)) {
        // Outer corner tile — two faces exposed
    }
    if (TileContext.isInterior(map, 5, 8)) {
        // Fully enclosed — add hidden chest or ore spawn
    }
}