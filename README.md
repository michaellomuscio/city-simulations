# Signal City

A living city in 3D, generated from a seed and simulated in the browser. Streets, a river with bridges, a central park and a skyline are laid out procedurally. Cars obey traffic signals, yield on left turns and wait for pedestrians. People walk the sidewalks and cross with the green. A day passes in twelve minutes, with lit windows at night, streetlights, headlights and changing weather.

## Run it

No build step and no dependencies. Three.js loads from a CDN.

```sh
npm start            # serves the folder at http://localhost:5173
# or any static server, e.g.
python3 -m http.server 5173
```

Open the page in a browser with WebGL 2 (any recent Chrome, Edge, Firefox or Safari). The module scripts need to be served over HTTP; opening `index.html` straight from disk won't work.

## What's simulated

**The city.** A grid of avenues and streets with uneven block sizes. Every third or so line is a four-lane boulevard with a planted median. A river crosses the city, spanned by bridges, with steel arches on the main ones. Some interior streets are removed to make room for a large park with a pond. Zoning falls off from downtown: glass towers (with one supertall), then mid-rise brick and stone, apartment blocks around courtyards, and suburban houses with pitched roofs. An industrial quarter sits on the south bank with warehouses, tank farms and smokestacks. There are also pocket parks, a civic plaza with City Hall and a fountain, and a construction site with a working crane. Highways leave the city on all four sides. The same seed always produces the same city.

**Traffic.** Each vehicle follows the car ahead using the [Intelligent Driver Model](https://en.wikipedia.org/wiki/Intelligent_driver_model). Every intersection is broken into turn paths, and each pair of paths that cross is precomputed. A car enters only when all of these hold:

- its signal is green, or yellow and too close to stop;
- no conflicting path is occupied, with a wider margin for buses and trucks;
- there is room on the far side, so it won't block the box;
- for a left turn, there is a gap in oncoming traffic.

Left-turners caught out by continuous oncoming traffic clear the intersection at the end of the green, as real drivers do. A short first-come claim system keeps anyone from waiting forever. Seven vehicle types (sedan, hatchback, SUV, taxi, van, box truck, bus) have their own size and acceleration, with brake lights and turn indicators. Volume follows weekday and weekend rush-hour profiles.

**Pedestrians.** People wander a sidewalk graph. At signalized corners they cross alongside the parallel green, but only when there's time to finish. Turning cars stop short of the crosswalk while anyone is in their path.

**Time and weather.** The sun and moon move across a procedural sky with clouds and stars. Windows switch on at different times depending on building use: offices empty in the evening, while homes are busiest after dinner. Weather drifts between clear, cloudy, rain, thunderstorms and fog. Rain wets the streets, which then dry slowly.

## Controls

| | |
|---|---|
| Drag / right-drag / scroll | Orbit / pan / zoom (touch: one finger, two fingers, pinch) |
| Click | Inspect a car, building or intersection |
| `W` `A` `S` `D`, arrows | Pan |
| `Q` `E` · `R` `F` | Rotate · zoom |
| `Space` · `1`–`4` | Pause · speed 1×, 2×, 4×, 8× |
| `T` · `C` · `V` | Aerial tour · follow a car · driver's seat |
| `Esc` · `H` · `?` | Free camera · hide panels · help |

The settings panel builds a new city from any seed in three sizes. It also adjusts traffic and pedestrian density, day length and graphics quality. Quality steps down automatically on slow devices.

## Project layout

```
index.html           page shell and HUD markup
src/main.js          wires simulation, rendering and UI together
src/sim/             rendering-free simulation (runs under Node)
  cityGen.js         procedural layout, zoning, buildings, trees, streetlights
  network.js         intersections, lanes, turn paths, conflicts, sidewalk graph
  signals.js         fixed-time signal controllers and walk signals
  traffic.js         vehicles: car following, right of way, routing, spawning
  pedestrians.js     walkers and crossing rules
  clock.js, weather.js, world.js
src/render/          Three.js scene: materials and shaders, buildings, streets,
                     terrain, props, vehicles, people, sky, camera, picking
src/ui/              HUD controller and styles
tests/               node:test suites for the simulation
```

## Tests

```sh
npm test
```

The suites cover the city generator (determinism, every zone present, buildings kept off the streets) and the road network (every lane reachable, symmetric conflicts, continuous turn paths, a connected sidewalk graph). They also cover the signals (cross directions never released together, walk time long enough to cross) and pedestrians (crossing only on a walk signal). The traffic suite runs several cities through rush hour and fails on any overlapping vehicles, red-light running or deadlock.
