<script>
  // Shared claim-success celebration: a self-drawing checkmark plus an optional
  // confetti burst. Styles live in app.css (.scan-success/.success-check/.confetti).
  let { text = '', confettiOn = true, children } = $props();

  const COLORS = ['#1f6f8f', '#2a7ea3', '#e0a53a', '#c96a4a', '#3f8f6a', '#e7c15a'];
  const confetti = confettiOn
    ? Array.from({ length: 42 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        color: COLORS[i % COLORS.length],
        delay: Math.random() * 0.25,
        duration: 0.9 + Math.random() * 0.7,
        rotate: (Math.random() * 720 - 360) | 0,
        drift: (Math.random() * 120 - 60) | 0,
        round: Math.random() < 0.5,
      }))
    : [];
</script>

<div class="scan-success">
  {#if confettiOn}
    <div class="confetti" aria-hidden="true">
      {#each confetti as p (p.id)}
        <span
          class="confetti-piece"
          class:round={p.round}
          style="left:{p.left}%; background:{p.color}; animation-delay:{p.delay}s; animation-duration:{p.duration}s; --rot:{p.rotate}deg; --drift:{p.drift}px"
        ></span>
      {/each}
    </div>
  {/if}
  <svg class="success-check" viewBox="0 0 52 52" role="img" aria-label="Success">
    <circle class="sc-circle" cx="26" cy="26" r="24" fill="none" />
    <path class="sc-check" fill="none" d="M14 27l8 8 16-18" />
  </svg>
  <p class="success-text">{text}</p>
  {#if children}{@render children()}{/if}
</div>
