import { serve } from "@hono/node-server";
import fastContentTypeParse from "fast-content-type-parse";
import { Hono } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import RSSParser from "rss-parser";
import xml2js from "xml2js";
import fetch, { Response } from "node-fetch";
import { useAgent } from "request-filtering-agent";

const app = new Hono();
const port = Number(process.env.PORT || 3000);
const patchRssHost = process.env.PATCHRSS_HOST || "localhost:3000";

const rssParser = new RSSParser();

const defaultErrorHeaders = {
  "cache-control": "public, s-maxage=60",
};

app.get("/", async (c) => {
  return c.redirect("https://blog.utgw.net/entry/patchrss");
});

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

  let fetchResp: Response;
  try {
    fetchResp = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": "patchrss (+https://blog.utgw.net/entry/patchrss)",
      },
      agent: useAgent(url.toString()),
    });
  } catch (ex) {
    if (!(ex instanceof Error && ex.message.startsWith("DNS lookup"))) {
      throw ex;
    }
    return c.text("Request blocked", 403, { ...defaultErrorHeaders });
  }

  if (!fetchResp.ok) {
    return c.text(
      `Not ok response returned: ${fetchResp.statusText}`,
      fetchResp.status as StatusCode,
      {
        ...defaultErrorHeaders,
      }
    );
  }
  let contentType = "application/rss+xml";
  const parsedContentType = fastContentTypeParse.safeParse(
    fetchResp.headers.get("content-type") ??
      "application/rss+xml; charset=utf-8"
  );
  if (parsedContentType.parameters.charset) {
    contentType += `; charset=${parsedContentType.parameters.charset}`;
  } else {
    contentType += "; charset=utf-8";
  }

  let patchedFeedStr: string;
  try {
    const feed = await rssParser.parseString(await fetchResp.text());
    patchedFeedStr = buildPatchedRSS(url.toString(), feed);
  } catch (ex) {
    return c.text("The returned response is not a valid RSS", 400, {
      ...defaultErrorHeaders,
    });
  }

  return c.text(patchedFeedStr, 200, {
    "content-type": contentType,
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
        title: feed.title ? `${feed.title} (patched)` : undefined,
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
