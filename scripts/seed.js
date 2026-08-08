'use strict';

// Seeds a handful of San Francisco zones with hints via the running server's
// admin API. Usage:
//   ADMIN_PASSWORD=... BASE_URL=http://localhost:3000 node scripts/seed.js
// Defaults: BASE_URL=http://localhost:3000, ADMIN_PASSWORD=changeme

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

// A small quad polygon (~120m across) centred on [lat, lng].
function quad(lat, lng, d = 0.0009) {
  return [
    [lat - d, lng - d],
    [lat - d, lng + d],
    [lat + d, lng + d],
    [lat + d, lng - d],
  ];
}

const ZONES = [
  {
    name: 'Golden Gate Park — Music Concourse',
    center: [37.7699, -122.4661],
    hint:
      'Between the de Young and the Academy of Sciences lies a sunken garden of pollarded sycamores. ' +
      'Stand at the great fountain and face the bandshell. The object is tucked where music has echoed ' +
      "since the 1900 World's Fair — look low, near the base of a column on the shaded side, where a " +
      'small ledge could hide something the size of a matchbox. Bring patience; tourists are everywhere.',
  },
  {
    name: 'Ferry Building Marketplace',
    center: [37.7955, -122.3937],
    hint:
      'Under the 245-foot clock tower modelled on the Giralda in Seville, the great hall smells of ' +
      'coffee and cheese. Walk the nave to the bay side and find the pillar nearest the outdoor ' +
      'farmers-market stalls. The cache clings to metal — a magnet is your friend. Do it before the ' +
      '10am ferry crowd swells and someone asks what you are doing.',
  },
  {
    name: 'Coit Tower — Pioneer Park',
    center: [37.8024, -122.4058],
    hint:
      'Climb Telegraph Hill (the wild parrots may heckle you). Circle the base of the tower until the ' +
      'Bay Bridge lines up perfectly between two cypress trees. From that exact sightline, the object ' +
      'is hidden at knee height along the low stone wall to your right — the WPA murals inside are a ' +
      "lovely reward once you've claimed it.",
  },
  {
    name: 'Alamo Square — Painted Ladies',
    center: [37.7764, -122.4329],
    hint:
      'The most photographed Victorians in the world sit across the street; the cache does not. Enter ' +
      'the park and climb to the crest where every tourist frames the skyline. Turn your back on the ' +
      'houses and find the bench facing the downtown view. Beneath its far armrest, on the underside, ' +
      'something waits. Sit casually — you are just admiring the fog rolling in.',
  },
  {
    name: 'Twin Peaks — Christmas Tree Point',
    center: [37.7544, -122.4477],
    hint:
      'Two hills, 922 feet, and the whole city at your feet. From the upper lookout, the antenna of ' +
      'Sutro Tower dominates the sky. Face it, then walk to the northernmost railing of the viewing ' +
      'area. The object is wedged among the rocks just below the rail — mind the wind, it will try to ' +
      'take your hat and your dignity. Best at sunset, worst when the fog eats the view.',
  },
  {
    name: 'Lands End — Sutro Baths Ruins',
    center: [37.7807, -122.5137],
    hint:
      'Where the Pacific hammers the cliffs, the concrete bones of a Victorian swimming palace still ' +
      'stand. Descend the trail toward the ruins and find the sea-cave mouth at the far end (check the ' +
      'tide first — this one is only reachable at low water). Near the cave entrance, above the reach ' +
      'of the waves, a dry nook holds the cache. Wear grippy shoes; the algae is merciless.',
  },
  {
    name: 'Union Square',
    center: [37.7880, -122.4074],
    hint:
      "Ringed by department stores and crowned by the Dewey Monument's bronze Victory, this plaza " +
      'never sleeps. Find the corner nearest the cable-car turnaround on Powell. A planter box there ' +
      'has a loose lower brick — behind it, the object hides in plain sight amid a thousand shoppers. ' +
      'Move quickly and act like you belong.',
  },
];

async function main() {
  const headers = { 'Content-Type': 'application/json', 'x-admin-password': ADMIN_PASSWORD };
  let created = 0;
  for (const z of ZONES) {
    const body = JSON.stringify({ name: z.name, hint: z.hint, polygon: quad(...z.center) });
    const res = await fetch(`${BASE_URL}/api/admin/zones`, { method: 'POST', headers, body });
    if (res.ok) {
      created++;
      console.log(`  \u2713 ${z.name}`);
    } else {
      const err = await res.text();
      console.error(`  \u2717 ${z.name}: ${res.status} ${err}`);
    }
  }
  console.log(`\nSeeded ${created}/${ZONES.length} zones into ${BASE_URL}.`);
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
