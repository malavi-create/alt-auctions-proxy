import fetch from "node-fetch";

const ALT_ENDPOINTS = [
  "https://api.alt.xyz/graphql",
  "https://app.alt.xyz/graphql",
  "https://alt.xyz/graphql"
];

const BROWSER_LIKE_HEADERS = {
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "Origin": "https://alt.xyz",
  "Referer": "https://alt.xyz/",
  // Generic desktop UA; some edges reject “node-fetch”
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
};

function isoToHuman(iso) {
  if (!iso) return { seconds: null, human: null };
  const end = new Date(iso).getTime();
  const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  return { seconds: left, human: `${d ? d + "d " : ""}${h}h ${m}m` };
}

async function tryAlt(body) {
  const errors = [];
  for (const url of ALT_ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: BROWSER_LIKE_HEADERS,
        body: JSON.stringify(body),
        redirect: "manual"          // don’t follow to HTML splash
      });

      const ct = r.headers.get("content-type") || "";
      const text = await r.text();

      // If server replied HTML, bubble up for visibility
      if (!ct.includes("application/json")) {
        return { ok: false, endpoint: url, status: r.status, html: text };
      }

      const json = JSON.parse(text);
      return { ok: r.ok && !json.errors, endpoint: url, status: r.status, json };
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  }
  throw new Error("All Alt endpoints failed: " + errors.join(" | "));
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
        input: { query: q, status: "ACTIVE", listingType: "AUCTION", limit, offset }
      }
    };

    const result = await tryAlt(body);

    // If we got HTML, show it so we can see what Alt is returning (often a 403/edge page)
    if (!result.ok && result.html) {
      return res
        .status(result.status || 502)
        .json({ endpoint: result.endpoint, error: "Non-JSON from Alt", preview: result.html.slice(0, 400) });
    }

    if (!result.ok) {
      return res
        .status(result.status || 502)
        .json({ endpoint: result.endpoint, error: "Alt returned error", details: result.json });
    }

    const payload = result.json?.data?.searchCards ?? { total: 0, items: [] };
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

    res.status(200).json({
      endpoint: result.endpoint,
      total: payload.total,
      limit,
      offset,
      items
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Proxy error" });
  }
}
