<script lang="ts">
  import { onMount } from 'svelte';
  import { Game } from './game/Game';
  import type { TileDebugInfo } from './game/tileDebug';
  let host: HTMLDivElement;
  let game: Game;
  let movement = 'Exploring the Emberwild';
  let tile: TileDebugInfo = { x: 0, y: 0, terrain: 'starter-ground', biome: 'grassland', walkable: true, contents: [], settlement: null };
  const seed = 'EMBERWILD-01';
  onMount(() => { game = new Game(host, seed, (state) => (movement = state), (info) => (tile = info)); return () => game.destroy(); });
</script>
<main class="game-shell">
  <div class="canvas-host" bind:this={host}></div>
  <section class="hud" aria-label="Adventure status">
    <div class="brand"><span class="brand-mark">✦</span><span>EMBERWILD</span></div>
    <div class="status"><span class:walking={movement === 'Walking'} class="status-dot"></span>{movement}</div>
    <div class="seed">WORLD SEED <strong>{seed}</strong></div>
  </section>
  {#if tile.settlement}
    <section class="settlement-banner" aria-label={`Current settlement: ${tile.settlement.name}`}>
      <div class="settlement-banner-type">{tile.settlement.type}</div>
      <div class="settlement-banner-name">{tile.settlement.name}</div>
    </section>
  {/if}
  <section class="tile-debug" aria-label="Current tile">
    <div class="tile-debug-title">CURRENT TILE · {tile.x}, {tile.y}</div>
    <div class="tile-debug-line">{tile.terrain} · {tile.biome} · {tile.walkable ? 'Walkable' : 'Impassable'}</div>
    <div class="tile-debug-line">Contains: {tile.contents.length ? tile.contents.join(' · ') : 'No notable features'}</div>
  </section>
</main>
