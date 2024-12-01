import { serve } from "@hono/node-server";
import { Hono } from "hono";
import RSSParser from "rss-parser";
import xml2js from "xml2js";

const app = new Hono();
const port = Number(process.env.PORT || 3000);
const patchRssHost = process.env.PATCHRSS_HOST || "localhost:3000";

const rssParser = new RSSParser({
  timeout: Number(process.env.RSS_PARSER_TIMEOUT_MSEC || 5000),
  headers: {
    "user-agent": "rsspatch (+https://rsspatch.utgw.net/)",
  },
});

const defaultErrorHeaders = {
  "cache-control": "public, s-maxage=60",
};

app.get("/rss", async (c) => {
  const { url: urlFromQuery } = c.req.query();
  if (!urlFromQuery) {
    return c.text("url query parameter not specified", 400, {
      ...defaultErrorHeaders,
    });
  }

  let url: URL;
  try {
    url = new URL(urlFromQuery);
  } catch (ex) {
    return c.text(`invalid url: ${urlFromQuery}`, 400, {
      ...defaultErrorHeaders,
    });
  }

  if (url.host === patchRssHost) {
    return c.text("request infinite loop detected", 400, {
      ...defaultErrorHeaders,
    });
  }

  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    return c.text("URL protocol must be either http or https", 400, {
      ...defaultErrorHeaders,
    });
  }

  const feed = await rssParser.parseURL(url.toString());
  const patchedFeedStr = buildPatchedRSS(url.toString(), feed);

  return c.text(patchedFeedStr, 200, {
    "content-type": "application/rss+xml",
    "cache-control": "public, s-maxage=60",
  });
});

const buildPatchedRSS = (
  originalUrl: string,
  feed: Awaited<ReturnType<typeof rssParser.parseURL>>
) => {
  const rssObj = {
    rss: {
      $: {
        version: "2.0",
        "xmlns:atom": "http://www.w3.org/2005/Atom",
      } as Record<string, any>,
      channel: {
        title: feed.title ? `${feed.generator} (patched)` : undefined,
        link: isValidUrl(feed.link)
          ? feed.link
          : assumeRSSLinkByOriginalUrl(originalUrl),
        description: feed.description,
        lastBuildDate: feed.lastBuildDate,
        generator: feed.generator
          ? `${feed.generator} (patched by rsspatch)`
          : undefined,
        item: [] as any[],
      },
    },
  };
  feed.items.forEach((item) => {
    Object.keys(item).forEach((key) => {
      if (key.startsWith("dc:")) {
        rssObj.rss.$["xmlns:dc"] = "http://purl.org/dc/elements/1.1/";
      }
    });

    rssObj.rss.channel.item.push({
      title: item.title,
      link: item.link,
      guid: item.guid
        ? {
            $: {
              isPermaLink: isGuidPermalink(item.guid),
            },
            _: item.guid,
          }
        : undefined,
      pubDate: item.pubDate,
      description: item.description,
      "dc:creator": item["dc:creator"],
    });
  });

  const rssBuilder = new xml2js.Builder();
  const result = rssBuilder.buildObject(rssObj);
  return result;
};

const isValidUrl = (urlLike: string | undefined) => {
  if (typeof urlLike === "undefined") {
    return false;
  }

  let url: URL;
  try {
    url = new URL(urlLike);
  } catch (ex) {
    return false;
  }

  return url.protocol === "https:" || url.protocol === "http:";
};

const isGuidPermalink = (guid: string) => isValidUrl(guid);

const assumeRSSLinkByOriginalUrl = (originalUrl: string) => {
  const m = originalUrl.match(
    /(https:\/\/adventar\.org\/calendars\/[0-9]+)\.rss/
  );
  if (m) {
    return m[1];
  }

  // fallback
  return originalUrl;
};

console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
  serverOptions: {
    requestTimeout: Number(process.env.HONO_REQUEST_TIMEOUT_MSEC || 10000),
  },
});
