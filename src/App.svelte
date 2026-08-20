<script lang="ts">
  import { onMount } from 'svelte';
  import { Game } from './game/Game';
  let host: HTMLDivElement;
  let game: Game;
  let movement = 'Exploring the Emberwild';
  const seed = 'EMBERWILD-01';
  onMount(() => { game = new Game(host, seed, (state) => (movement = state)); return () => game.destroy(); });
</script>
<main class="game-shell">
  <div class="canvas-host" bind:this={host}></div>
  <section class="hud" aria-label="Adventure status">
    <div class="brand"><span class="brand-mark">✦</span><span>EMBERWILD</span></div>
    <div class="status"><span class:walking={movement === 'Walking'} class="status-dot"></span>{movement}</div>
    <div class="seed">WORLD SEED <strong>{seed}</strong></div>
  </section>
  <div class="hint">Tap the wilds to travel</div>
</main>
