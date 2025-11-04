import fetch from "node-fetch";

// helper to show time remaining
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
          status: "ACTIVE",        // live
          listingType: "AUCTION",  // auctions only
          limit,
          offset
        }
      }
    };

    const r = await fetch("https://api.alt.xyz/v1/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const j = await r.json();
    if (!r.ok || j.errors) {
      return res.status(r.status || 500).json(j);
    }

    const payload = j?.data?.searchCards ?? { total: 0, items: [] };
    const items = (payload.items || []).map(it => {
      const tr = isoToHuman(it.endAt);
      return {
        id: it.id,
        title: it.title,
        url: it.url,
        imageUrl: it.imageUrl,
        status: it.status,          // should be ACTIVE
        listingType: it.listingType, // should be AUCTION
        endAt: it.endAt,
        bidCount: it.bidCount ?? null,
        currentPrice: it.price != null ? { value: it.price, currency: "USD" } : null,
        timeRemainingSeconds: tr.seconds,
        timeRemainingHuman: tr.human
      };
    });

    res.status(200).json({ total: payload.total, limit, offset, items });
  } catch (e) {
    res.status(500).json({ error: e.message || "Proxy error" });
  }
}
