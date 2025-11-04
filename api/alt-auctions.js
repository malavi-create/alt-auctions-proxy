import fetch from "node-fetch";

// Try multiple Alt GraphQL endpoints and use the first that works.
const ALT_ENDPOINT_CANDIDATES = [
  "https://api.alt.xyz/graphql",
  "https://app.alt.xyz/graphql",
  "https://alt.xyz/graphql"
];

async function postGraphQL(body) {
  const errors = [];
  for (const url of ALT_ENDPOINT_CANDIDATES) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // If DNS resolved and we got a response, return it (even if it's a 4xx/5xx we'll surface below)
      return { response: r, endpoint: url };
    } catch (e) {
      // Keep track of which endpoint failed and why (e.g., ENOTFOUND)
      errors.push({ url, message: e.message });
    }
  }
  // None resolved — throw a helpful error
  const detail = errors.map(x => `${x.url} → ${x.message}`).join(" | ");
  throw new Error(`All Alt endpoints failed DNS/connection: ${detail}`);
}

function isoToHuman(iso) {
  if (!iso) return { seconds: null, human: null };
  const end = new Date(iso).getTime();
  const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  return { seconds: left, human: `${d ? d + "d " : ""}${h}h ${m}m` };
}

export default async function handler(req, res) {
  try {
    const q = req.query.q || "";
    const limit = parseInt(req.query.limit || "40", 10);
    const offset = parseInt(req.query.offset || "0", 10);

    const body = {
      query: `
        query SearchCards($input: CardSearchInput!) {
          searchCards(input: $input) {
            total
            items {
              id
              title
              price
              url
              imageUrl
              status
              listingType
              endAt
              bidCount
            }
          }
        }`,
      variables: {
        input: {
          query: q,
          status: "ACTIVE",        // live only
          listingType: "AUCTION",  // auctions only
          limit,
          offset
        }
      }
    };

    const { response, endpoint } = await postGraphQL(body);
    const json = await response.json();

    if (!response.ok || json.errors) {
      return res
        .status(response.status || 500)
        .json({ endpoint, ...json });
    }

    const payload = json?.data?.searchCards ?? { total: 0, items: [] };
    const items = (payload.items || []).map(it => {
      const tr = isoToHuman(it.endAt);
      return {
        id: it.id,
        title: it.title,
        url: it.url,
        imageUrl: it.imageUrl,
        status: it.status,
        listingType: it.listingType,
        endAt: it.endAt,
        bidCount: it.bidCount ?? null,
        currentPrice: it.price != null ? { value: it.price, currency: "USD" } : null,
        timeRemainingSeconds: tr.seconds,
        timeRemainingHuman: tr.human
      };
    });

    res.status(200).json({ endpoint, total: payload.total, limit, offset, items });
  } catch (e) {
    res.status(500).json({ error: e.message || "Proxy error" });
  }
}
