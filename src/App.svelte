<script lang="ts">
  import { onMount } from 'svelte';
  import { Game } from './game/Game';
  import type { TileDebugInfo } from './game/tileDebug';
  import type { NearbySettlement, NearbySettlementResult } from './game/regions';
  let host: HTMLDivElement;
  let game: Game | undefined;
  let movement = 'Exploring the Emberwild';
  let tile: TileDebugInfo = { x: 0, y: 0, terrain: 'starter-ground', biome: 'grassland', walkable: true, contents: [], settlement: null };
  let settingsOpen = false;
  let showTileDebug = true;
  let destinations: NearbySettlementResult | null = null;
  let destinationLoading = false;
  let destinationError = '';
  let transportPending = false;
  let destinationRequest = 0;
  const seed = 'EMBERWILD-01';
  onMount(() => { game = new Game(host, seed, (state) => (movement = state), (info) => (tile = info)); return () => game?.destroy(); });
  async function openSettings() { settingsOpen = true; await loadDestinations(1); }
  async function loadDestinations(radius: number) {
    if (!game) return; const request = ++destinationRequest; destinationLoading = true; destinationError = '';
    try { const result = await game.getNearbySettlements(radius); if (request === destinationRequest && settingsOpen) destinations = result; }
    catch (error) { if (request === destinationRequest && settingsOpen) destinationError = error instanceof Error ? error.message : 'Unable to load nearby settlements'; }
    finally { if (request === destinationRequest) destinationLoading = false; }
  }
  async function chooseDestination(destination: NearbySettlement) { if (!game || transportPending) return; settingsOpen = false; transportPending = true; await game.transportTo(destination); transportPending = false; }
  function closeSettings() { settingsOpen = false; destinationRequest++; }
  function handleKeydown(event: KeyboardEvent) { if (event.key === 'Escape' && settingsOpen) closeSettings(); }
</script>
<svelte:window on:keydown={handleKeydown} />
<main class="game-shell">
  <div class="canvas-host" bind:this={host}></div>
  <section class="hud" aria-label="Adventure status">
    <div class="brand"><span class="brand-mark">✦</span><span>EMBERWILD</span></div>
    <div class="status" role="status" aria-live="polite"><span class:walking={movement === 'Walking'} class="status-dot"></span>{movement}</div>
    <div class="seed">WORLD SEED <strong>{seed}</strong></div>
    <button class="settings-button" type="button" aria-haspopup="dialog" aria-expanded={settingsOpen} on:click={openSettings}>Settings</button>
  </section>
  {#if tile.settlement}
    <section class="settlement-banner" aria-label={`Current settlement: ${tile.settlement.name}`}>
      <div class="settlement-banner-type">{tile.settlement.type}</div>
      <div class="settlement-banner-name">{tile.settlement.name}</div>
    </section>
  {/if}
  {#if showTileDebug}<section class="tile-debug" aria-label="Current tile">
    <div class="tile-debug-title">CURRENT TILE · {tile.x}, {tile.y}</div>
    <div class="tile-debug-line">{tile.terrain} · {tile.biome} · {tile.walkable ? 'Walkable' : 'Impassable'}</div>
    <div class="tile-debug-line">Contains: {tile.contents.length ? tile.contents.join(' · ') : 'No notable features'}</div>
  </section>{/if}
  {#if settingsOpen}
    <div class="settings-backdrop" role="presentation" on:click={closeSettings}>
      <dialog open class="settings-dialog" aria-labelledby="settings-title" on:click|stopPropagation>
        <div class="settings-header"><div><div class="settings-kicker">EMBERWILD</div><h1 id="settings-title">Settings</h1></div><button class="settings-close" type="button" aria-label="Close settings" on:click={closeSettings}>×</button></div>
        <label class="debug-toggle"><input type="checkbox" bind:checked={showTileDebug} /> <span>Show tile info debug panel</span></label>
        <div class="destination-section"><div class="destination-heading"><h2>Nearby settlements</h2><span>Travel</span></div>
          {#if destinationLoading}<p class="settings-message">Reading the world…</p>
          {:else if destinationError}<p class="settings-message settings-error">{destinationError}</p><button class="secondary-button" type="button" on:click={() => loadDestinations(destinations?.searchedRadius ?? 1)}>Retry</button>
          {:else if destinations?.settlements.length}
            <div class="destination-list">{#each destinations.settlements as destination (destination.id)}<button class="destination-row" type="button" disabled={transportPending} on:click={() => chooseDestination(destination)}><span><strong>{destination.name}</strong><small>{destination.type} · {Math.round(destination.distance)} tiles</small></span><span class="destination-arrow">→</span></button>{/each}</div>
            {#if !destinations.complete}<button class="secondary-button" type="button" on:click={() => loadDestinations(destinations!.searchedRadius + 2)}>Search farther</button>{/if}
          {:else}<p class="settings-message">No settlements in this area yet.</p><button class="secondary-button" type="button" on:click={() => loadDestinations(destinations?.searchedRadius ? destinations.searchedRadius + 2 : 3)}>Search farther</button>{/if}
        </div>
      </dialog>
    </div>
  {/if}
</main>
