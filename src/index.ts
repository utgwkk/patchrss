import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

const defaultErrorHeaders = {
  "cache-control": "public, max-age=60, s-maxage=60",
};

app.get("/", (c) => {
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

  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    return c.text("URL protocol must be either http or https", 400, {
      ...defaultErrorHeaders,
    });
  }

  return c.text(url.toString());
});

const port = Number(process.env.PORT || 3000);
console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
