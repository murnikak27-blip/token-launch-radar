// Token launch radar: the value model, the board and the farm plans.
//
// The model prices a token that does not exist yet. For every protocol in the
// snapshot that records no token, it asks what a token would be worth if the
// protocol's record stayed exactly as it is, and answers from the snapshot's
// own figures alone:
//
//   implied = TVL x peer multiple x momentum x tokenless age x chain reach
//
// The peer multiple is the median market-cap/TVL ratio of the protocols in
// the same DefiLlama category that DO have a token, shrunk toward the global
// median when a category has few tokenized peers, so a thin category cannot
// produce a wild multiple. Momentum reads the seven-day TVL change, tokenless
// age reads how long the protocol has run at size with no token, and chain
// reach counts its deployments. A protocol that is a versioned child of a
// tokenized parent (an "Aave V3" beside a trading AAVE) is discounted hard:
// its value accrues to the parent's token, not to a new one.
//
// Nothing here is a hardcoded list of names: move the snapshot and the board
// moves. Protocols that already record a token are set aside as the live set;
// the board ranks only the pre-token field, watchlist first by value.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Scored {
  protocol: Protocol;
  multiple: number;
  peers: number;
  momentum: number;
  age_years: number | null;
  age_factor: number;
  reach_factor: number;
  child_of: string | null;
  child_factor: number;
  implied_value_usd: number;
  watchlisted: boolean;
}

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  floor_usd: number;
  protocol_count: number;
  watchlist_count: number;
  live_count: number;
  global_multiple: number;
  multiples: { category: string; multiple: number; peers: number }[];
  rows: (Row & {
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    listed_at: string | null;
    watchlisted: boolean;
    multiple: number;
    peers: number;
    momentum: number;
    age_years: number | null;
    age_factor: number;
    reach_factor: number;
    child_of: string | null;
    child_factor: number;
  })[];
}

const DAY_MS = 86_400_000;
const BOARD_SIZE = 220;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist');
  }
  return raw;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Normalised name stem: lowercase, alphanumerics only, version markers cut. */
function stem(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(v\d+(\.\d+)?|\d+\.\d+)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const VERSIONED = /\b(v\d+(\.\d+)?|\d+\.\d+)\s*$/i;
const DERIVATIVE = /\b(wrapped|staked|staking|liquid staked)\b/i;

/**
 * Score every pre-token protocol. Returns the scored field sorted by implied
 * value, plus the peer-multiple table the dashboard shows.
 */
/**
 * A token is recorded exactly as the snapshot's own rule reads it: the record
 * carries no token only when BOTH ids are null, so either one present means
 * the token exists (many records carry a symbol with no gecko id).
 */
function recordsToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/**
 * Custodial and derivative categories, the same families the watchlist rule
 * keeps off the floor: their TVL is other protocols' assets in custody, not a
 * product of their own waiting for a token. Extra rows skip them; watchlist
 * rows are the house's own call and always stay.
 */
const CUSTODIAL = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange balance records are not protocols waiting for a token. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

export function scoreField(snapshot: Snapshot): {
  scored: Scored[];
  global_multiple: number;
  multiples: RadarData['multiples'];
  live_count: number;
} {
  const tokenized = snapshot.protocols.filter((p) => recordsToken(p));
  // Peer ratios are winsorized before any median: one micro-cap token on a
  // near-zero TVL must not price a whole category.
  const ratioOf = (p: Protocol): number => clamp(p.mcap_usd! / p.tvl_usd, 0.005, 5);
  const priced = tokenized.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratios = priced.map(ratioOf);
  const global_multiple = ratios.length > 0 ? median(ratios) : 1;

  const byCategory = new Map<string, number[]>();
  for (const p of priced) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(ratioOf(p));
    byCategory.set(p.category, list);
  }
  const multiples: RadarData['multiples'] = [];
  const multipleOf = new Map<string, { multiple: number; peers: number }>();
  for (const [category, list] of byCategory) {
    const shrunk = clamp((list.length * median(list) + 6 * global_multiple) / (list.length + 6), 0.02, 3);
    multipleOf.set(category, { multiple: shrunk, peers: list.length });
    multiples.push({ category, multiple: shrunk, peers: list.length });
  }
  multiples.sort((a, b) => b.multiple - a.multiple);

  // Tokenized parents by name stem, for the child-product discount. When
  // several records share a stem, the unversioned one names the parent.
  const parents = new Map<string, string>();
  for (const p of tokenized) {
    const key = stem(p.name);
    const current = parents.get(key);
    if (current === undefined || (VERSIONED.test(current) && !VERSIONED.test(p.name))) {
      parents.set(key, p.name);
    }
  }

  const asOf = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const watchlist = new Set(snapshot.watchlist);

  const scored: Scored[] = [];
  for (const p of snapshot.protocols) {
    if (recordsToken(p)) continue; // the live set: already trading
    if (!watchlist.has(p.slug)) {
      if (EXCHANGE_PREFIX.test(p.name)) continue; // an exchange's balances
      if (p.category !== null && CUSTODIAL.has(p.category)) continue; // custody, not a product
    }
    const peerInfo =
      p.category !== null && multipleOf.has(p.category)
        ? multipleOf.get(p.category)!
        : { multiple: global_multiple, peers: 0 };
    const change = p.change_7d ?? 0;
    const momentum = 1 + 0.5 * (clamp(change, -30, 60) / 100);
    let age_years: number | null = null;
    let age_factor = 1;
    if (p.listed_at !== null) {
      const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
      if (!Number.isNaN(listed) && !Number.isNaN(asOf)) {
        age_years = Math.max(0, (asOf - listed) / (365.25 * DAY_MS));
        age_factor = 1 + 0.06 * Math.min(age_years, 6);
      }
    }
    const reach_factor = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 8);
    let child_of: string | null = null;
    let child_factor = 1;
    const ownStem = stem(p.name);
    if (parents.has(ownStem) && parents.get(ownStem) !== p.name) {
      child_of = parents.get(ownStem)!;
      child_factor = 0.35;
    } else {
      // A name that extends a tokenized parent's stem ("Ethena USDe" beside
      // Ethena) is that parent's product, not a new launch waiting to happen.
      for (const [parentStem, parentName] of parents) {
        if (parentStem.length >= 4 && ownStem.startsWith(`${parentStem} `)) {
          child_of = parentName;
          child_factor = 0.35;
          break;
        }
      }
      if (child_of === null && DERIVATIVE.test(p.name)) child_factor = 0.5;
    }
    const implied = Math.max(
      1,
      Math.round(p.tvl_usd * peerInfo.multiple * momentum * age_factor * reach_factor * child_factor),
    );
    scored.push({
      protocol: p,
      multiple: peerInfo.multiple,
      peers: peerInfo.peers,
      momentum,
      age_years,
      age_factor,
      reach_factor,
      child_of,
      child_factor,
      implied_value_usd: implied,
      watchlisted: watchlist.has(p.slug),
    });
  }
  scored.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.protocol.tvl_usd - a.protocol.tvl_usd ||
      (a.protocol.slug < b.protocol.slug ? -1 : 1),
  );
  return { scored, global_multiple, multiples, live_count: tokenized.length };
}

function money(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(usd >= 100_000_000 ? 0 : 1)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`;
  return `$${usd}`;
}

function chainList(chains: string[], max = 3): string {
  if (chains.length === 0) return 'its main deployment';
  const head = chains.slice(0, max).join(', ');
  return chains.length > max ? `${head} and ${chains.length - max} more chains` : head;
}

/** A suggested working position, scaled to the protocol's size. */
function position(tvl: number): number {
  return clamp(Math.round((tvl * 0.00002) / 50) * 50, 100, 10_000);
}

type Playbook = (s: Scored) => string[];

const PLAYBOOKS: Record<string, Playbook> = {
  Dexs: (s) => {
    const p = s.protocol;
    const pos = position(p.tvl_usd);
    return [
      `Swap on ${p.name} itself, not an aggregator that routes through it silently: run ${money(pos)} of volume a week across ${chainList(p.chains)}, split between majors and the pool pairs ${p.name} promotes, so the activity reads as real flow.`,
      `Provide ${money(pos)} of liquidity to one of ${p.name}'s top three pools by TVL for a full 10-week season; claim and restake the LP rewards weekly instead of letting them sit idle.`,
      `Use the features only direct users touch: place limit orders, try the newest pool type or hook, and vote in any gauge or bribe market ${p.name} runs, about 30 minutes a week.`,
      `Keep a simple log of volume, fees paid and LP returns per week; stop adding size if your share of a pool passes 1%, which dilutes rewards and raises impermanent-loss risk.`,
    ];
  },
  Lending: (s) => {
    const p = s.protocol;
    const pos = position(p.tvl_usd);
    return [
      `Supply ${money(pos)} of blue-chip collateral (ETH or a major stablecoin) to ${p.name} on ${chainList(p.chains, 2)} and leave it supplied through a full 10-week season; supplied balances are what points and snapshots count.`,
      `Run one conservative borrow loop: borrow at most 40% against the collateral, re-supply the borrowed asset, and keep the health factor above 2.0 so a volatile week cannot liquidate you.`,
      `Repay and re-borrow once a fortnight and claim every reward the market offers; active borrowers are the users a lending token launch rewards first.`,
      `Spread a second, smaller position over a second chain deployment of ${p.name} rather than doubling the first: breadth across deployments is cheap insurance if the launch weights chains separately.`,
    ];
  },
  Derivatives: (s) => {
    const p = s.protocol;
    const pos = position(p.tvl_usd);
    return [
      `Trade perps on ${p.name} with ${money(pos)} of margin, two or three sessions a week for 10 weeks; favour steady volume over size, and keep each position under 5x leverage so fees, not liquidations, are your cost.`,
      `Deposit ${money(pos)} into ${p.name}'s house vault or liquidity pool if it runs one and leave it for the season; vault shares are the cleanest record of early risk capital.`,
      `Use the newer markets and features (fresh pairs, options or the testnet-to-mainnet features) in the weeks they launch, when usage weighting is usually highest.`,
      `Log fees paid and funding earned weekly; if your net cost passes 8% of margin in a month, halve the size and keep the streak rather than the volume.`,
    ];
  },
  Bridge: (s) => {
    const p = s.protocol;
    const pos = position(p.tvl_usd);
    return [
      `Bridge ${money(pos)} a week through ${p.name} in both directions between ${chainList(p.chains)}; round trips on real routes count far more than one large transfer.`,
      `Vary the assets and corridors: one stablecoin route, one ETH route and one long-tail route a week reads as genuine usage, about 20 minutes a week.`,
      `If ${p.name} runs a relayer, solver or staking role, take the smallest useful version of it for a season; infrastructure roles are rare and usually weighted heavily at a launch.`,
      `Keep bridging through quiet weeks as well as busy ones: consistency across a 10-week window is the pattern sybil filters keep and bursts fail.`,
    ];
  },
  Yield: (s) => {
    const p = s.protocol;
    const pos = position(p.tvl_usd);
    return [
      `Deposit ${money(pos)} into ${p.name}'s flagship vault on ${chainList(p.chains, 2)} and hold the position for a full 10-week season without round-tripping it.`,
      `Split a second ${money(Math.round(pos / 2))} across two more vaults or strategies so your record covers the product range, not one pool.`,
      `Claim and compound rewards weekly; set a calendar reminder, because unclaimed rewards are the first thing a snapshot leaves behind.`,
      `Watch the vault's underlying: if its TVL falls by a third in a fortnight, move to the next strategy on ${p.name} rather than leaving the protocol altogether.`,
    ];
  },
  CDP: (s) => {
    const p = s.protocol;
    const pos = position(p.tvl_usd);
    return [
      `Open a vault on ${p.name} with ${money(pos)} of collateral and mint its stablecoin at under 50% of the liquidation limit; an open, healthy position is the core record.`,
      `Use the minted stablecoin inside the ecosystem (LP it or lend it) so both sides of ${p.name}'s balance sheet show your address.`,
      `Top up or partially repay monthly to keep the position active across a 10-week season, and claim any stability-pool rewards on schedule.`,
      `Keep a liquidation buffer in a separate wallet: one cascade should never close the position that carries your history.`,
    ];
  },
  'Risk Curators': (s) => {
    const p = s.protocol;
    const pos = position(p.tvl_usd);
    return [
      `Allocate ${money(pos)} across two or three of the vaults curated through ${p.name} on ${chainList(p.chains, 2)}, favouring curators with the longest record.`,
      `Hold through a full 10-week season and rebalance only when a curator changes strategy, not on weekly rate moves.`,
      `Claim rewards weekly and keep the deposit receipts; curated-vault launches tend to reward deposit age as much as size.`,
      `Cap any single vault at half the position: curator risk is idiosyncratic and diversification is the whole point of the category.`,
    ];
  },
};

const FALLBACK: Playbook = (s) => {
  const p = s.protocol;
  const pos = position(p.tvl_usd);
  const kind = p.category ?? 'protocol';
  return [
    `Use ${p.name} as a real user of a ${kind.toLowerCase()} product: put ${money(pos)} to work on ${chainList(p.chains, 2)} and keep it active for a full 10-week season.`,
    `Touch the product weekly rather than in one burst: small recurring actions over 10 weeks build the record that launch snapshots reward.`,
    `Cover a second feature or a second chain deployment of ${p.name} with a smaller ${money(Math.round(pos / 2))} position; breadth is cheap and often weighted.`,
    `Claim every point, badge or reward the product issues, and keep your own log of costs so you can stop if the season's spend passes what a plausible launch would repay.`,
  ];
};

const KEYWORD_BOOKS: [RegExp, Playbook][] = [
  [/perp|derivative|futures/i, PLAYBOOKS.Derivatives!],
  [/bridge|swap.*cross|cross/i, PLAYBOOKS.Bridge!],
  [/lend|borrow/i, PLAYBOOKS.Lending!],
  [/dex|swap|amm/i, PLAYBOOKS.Dexs!],
  [/yield|vault|farm/i, PLAYBOOKS.Yield!],
  [/cdp|stablecoin/i, PLAYBOOKS.CDP!],
];

export function farmSteps(s: Scored): string[] {
  const p = s.protocol;
  let book = p.category !== null ? PLAYBOOKS[p.category] : undefined;
  if (book === undefined) {
    for (const [pattern, candidate] of KEYWORD_BOOKS) {
      if (pattern.test(`${p.category ?? ''} ${p.name}`)) {
        book = candidate;
        break;
      }
    }
  }
  const steps = (book ?? FALLBACK)(s).map((step) => step.trim());
  if (s.child_of !== null) {
    steps.push(
      `Size this one carefully: ${p.name} is a version of ${s.child_of}, whose token already trades, so a separate launch is the less likely path; farm it only while the rewards themselves pay.`,
    );
  } else if (s.watchlisted) {
    steps.push(
      `This is a watchlist position: at ${money(p.tvl_usd)} of TVL with no token recorded, ${p.name} is the size this radar exists for, so run the plan for the full season rather than testing for a week.`,
    );
  }
  return steps.slice(0, 12);
}

/** Build the ranked board and the dashboard's data from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: RadarData } {
  const { scored, global_multiple, multiples, live_count } = scoreField(snapshot);
  const watchlisted = scored.filter((s) => s.watchlisted);
  const rest = scored.filter((s) => !s.watchlisted);
  const chosen = [...watchlisted, ...rest].slice(0, Math.max(BOARD_SIZE, watchlisted.length));
  const ranked = [...chosen].sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.protocol.tvl_usd - a.protocol.tvl_usd ||
      (a.protocol.slug < b.protocol.slug ? -1 : 1),
  );
  const rows: Row[] = ranked.map((s, i) => ({
    slug: s.protocol.slug,
    name: s.protocol.name,
    rank: i + 1,
    implied_value_usd: s.implied_value_usd,
    farm_steps: farmSteps(s),
  }));
  const bySlug = new Map(ranked.map((s) => [s.protocol.slug, s]));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    protocol_count: snapshot.protocols.length,
    watchlist_count: snapshot.watchlist.length,
    live_count,
    global_multiple,
    multiples,
    rows: rows.map((row) => {
      const s = bySlug.get(row.slug)!;
      const p = s.protocol;
      return {
        ...row,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        listed_at: p.listed_at,
        watchlisted: s.watchlisted,
        multiple: s.multiple,
        peers: s.peers,
        momentum: s.momentum,
        age_years: s.age_years,
        age_factor: s.age_factor,
        reach_factor: s.reach_factor,
        child_of: s.child_of,
        child_factor: s.child_factor,
      };
    }),
  };
  return { board: rows, radar };
}

/** The dashboard's data as the script the page loads. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Null when the board passes the gate's shape, else the first problem. */
export function boardIssue(board: Row[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    if (row.rank !== i + 1) return `rank ${row.rank} breaks the 1..N run`;
    if (!slugs.has(row.slug)) return `slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!(row.implied_value_usd > 0)) return `${row.slug} has no positive implied value`;
    if (row.implied_value_usd > previous) return `${row.slug} rises against its rank`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps.length} farm steps, outside 3..12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug} has a farm step of ${len} characters`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  if (new Set(board.map((r) => r.implied_value_usd)).size < 2) return 'every implied value is the same';
  return null;
}
