// Fictional names for the city, its streets and its buildings.

const CITY_PREFIX = ['Port', 'New', 'East', 'West', 'Lake', 'Fort', 'Mount', 'North', 'South'];
const CITY_ROOT = [
  'Avalon', 'Calloway', 'Merrow', 'Ashford', 'Halden', 'Brightwater', 'Kingsbridge', 'Larkspur',
  'Westmere', 'Harrowgate', 'Ellisport', 'Novara', 'Belmont', 'Rivenhall', 'Thornbury', 'Glenhaven',
  'Copperton', 'Fairhaven', 'Ironwood', 'Silverlake', 'Oakridge', 'Stonemill', 'Bayview', 'Clearwater',
  'Redmont', 'Ravensport', 'Alderney', 'Corrigan', 'Valmora', 'Easton', 'Marisol', 'Hollins',
];
const RIVER_NAMES = ['Ash', 'Silver', 'Merrow', 'Kettle', 'Alder', 'Heron', 'Willow', 'Stone', 'Otter', 'Black'];

const TREES = [
  'Maple', 'Oak', 'Elm', 'Cedar', 'Birch', 'Walnut', 'Pine', 'Spruce', 'Willow', 'Chestnut', 'Hickory',
  'Laurel', 'Poplar', 'Juniper', 'Magnolia', 'Sycamore', 'Linden', 'Hawthorn', 'Aspen', 'Cypress',
];
const MAJOR_NAMES = [
  'Harbor', 'Union', 'Commerce', 'Liberty', 'Central', 'Grand', 'Market', 'Franklin', 'Lincoln',
  'Washington', 'Riverside', 'Broad', 'Main', 'Victory', 'Republic', 'Founders', 'Meridian', 'Canal',
];
const SURNAMES = [
  'Halvorsen', 'Prescott', 'Whitfield', 'Okafor', 'Lindqvist', 'Moreau', 'Castellan', 'Ashby', 'Nakamura',
  'Delacroix', 'Vance', 'Ferreira', 'Adeyemi', 'Kowalski', 'Sterling', 'Marchetti', 'Tanaka', 'Holloway',
  'Brennan', 'Iversen', 'Quintero', 'Abernathy', 'Rosenthal', 'Mbeki', 'Calder', 'Fairbanks', 'Oyelaran',
];
const TOWER_WORDS = [
  'Meridian', 'Pinnacle', 'Beacon', 'Summit', 'Atlas', 'Horizon', 'Keystone', 'Vantage', 'Monarch',
  'Zenith', 'Liberty', 'Crown', 'Apex', 'Sapphire', 'Paragon', 'Halcyon', 'Sterling', 'Cobalt', 'Aurora',
];
const RES_WORDS = ['Linden', 'Garden', 'Parkview', 'Riverside', 'Hillcrest', 'Brookside', 'Ivy', 'Fairview', 'Elmwood', 'Juniper'];
const INDUSTRY = ['Steelworks', 'Logistics', 'Textiles', 'Foundry', 'Bottling Co.', 'Cold Storage', 'Printing', 'Machine Works', 'Freight', 'Paper Mill'];
const SHOPS = ['Market', 'Exchange', 'Arcade', 'Building', 'Block', 'Hall', 'House', 'Lofts'];

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function makeNames(rng) {
  const prefix = rng.chance(0.35) ? rng.pick(CITY_PREFIX) + ' ' : '';
  const city = prefix + rng.pick(CITY_ROOT);
  const river = rng.pick(RIVER_NAMES) + ' River';
  const majors = rng.shuffle([...MAJOR_NAMES]);
  const trees = rng.shuffle([...TREES]);
  let majorIdx = 0;
  let treeIdx = 0;
  let avenueNum = 1;

  return {
    city,
    river,
    /** North-south lines are avenues, east-west lines are streets. */
    lineName(axis, major) {
      if (axis === 'ns') {
        if (major) return `${majors[majorIdx++ % majors.length]} Boulevard`;
        return `${ordinal(avenueNum++)} Avenue`;
      }
      if (major) return `${majors[majorIdx++ % majors.length]} Street`;
      return `${trees[treeIdx++ % trees.length]} Street`;
    },
    tower() {
      const r = rng.next();
      if (r < 0.3) return `${rng.pick(SURNAMES)} Tower`;
      if (r < 0.55) return `The ${rng.pick(TOWER_WORDS)}`;
      if (r < 0.75) return `${rng.pick(TOWER_WORDS)} Center`;
      return `${rng.pick(SURNAMES)} ${rng.pick(['Plaza', 'Building', 'Trust Building', 'Financial Center'])}`;
    },
    midrise() {
      return `${rng.pick(SURNAMES)} ${rng.pick(SHOPS)}`;
    },
    residential() {
      const r = rng.next();
      if (r < 0.4) return `${rng.pick(RES_WORDS)} Apartments`;
      if (r < 0.7) return `${rng.pick(TREES)} Court`;
      return `The ${rng.pick(SURNAMES)}`;
    },
    industrial() {
      return `${rng.pick(SURNAMES)} ${rng.pick(INDUSTRY)}`;
    },
    house() {
      return `${rng.pick(SURNAMES)} residence`;
    },
    plate() {
      const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
      const d = () => rng.int(0, 9);
      const l = () => L[rng.int(0, L.length - 1)];
      return `${d()}${l()}${l()}${l()}·${d()}${d()}${d()}`;
    },
  };
}
