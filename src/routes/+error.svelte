<script>
  import { page } from '$app/state';
  import BrandIcon from '$lib/BrandIcon.svelte';

  const notFound = $derived(page.status === 404);
</script>

<svelte:head>
  <title>{notFound ? 'Not found' : 'Error'} · C.A.R.E.</title>
</svelte:head>

<div class="topbar">
  <div class="brand">
    <h1><BrandIcon /> C.A.R.E.</h1>
  </div>
  <div class="spacer"></div>
  <a class="badge" href="/">Map</a>
</div>

<div class="center-wrap">
  <div class="card">
    <h2>{notFound ? 'Page not found' : 'Something went wrong'}</h2>
    <p class="muted">
      {notFound ? 'There\u2019s nothing at this address.' : 'Please try again in a moment.'}
    </p>
    <div class="btn-row"><a class="button" href="/">Back to the map</a></div>
  </div>
</div>
