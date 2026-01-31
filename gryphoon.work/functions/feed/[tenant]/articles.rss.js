import { comp, iterator, map, take } from "@thi.ng/transducers";
import { Feed } from "feed";

/** @typedef {import("feed").FeedOptions} FeedOptions */

/**
 * @param {FeedOptions} feedInit
 * @returns {FeedOptions}
 */
function template(feedInit) {
  return Object.assign({}, feedInit, {
    copyright: feedInit.copyright.replace("{{year}}", new Date().getFullYear()),
    generator: "Gryphoon 4.0",
  });
}

/**
 * @param {FeedOptions} feedInit
 * @param {Object[]} items
 * @returns {Response}
 */
async function rssFeed(feedInit, items) {
  const feed = new Feed(template(feedInit));
  for (const { entry } of items) {
    feed.addItem({
      author: [{ email: "noreply@example.com", name: entry.author }],
      title: entry.title,
      link: entry.link ?? entry.url,
      description: entry.description,
      enclosure: entry.image ? { url: entry.image } : undefined,
    });
  }
  return new Response(feed.rss2(), {
    headers: {
      "Content-Type": "application/rss+xml;charset=utf-8",
      "Cache-Control": "max-age=3600",
    },
  });
}

/**
 *
 * @param {EventContext<Env>} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet({ request, env, params }) {
  const { searchParams } = new URL(request.url);
  const pageSize = Math.max(0, Number.parseInt(searchParams.get("page") ?? "10", 10));
  const tag = searchParams.get("tag");

  const articles = await env.articlesShare.getByName(params.tenant);
  const feed = await articles.getFeed();
  const data = await articles.getIndex(tag);
  const pagedEntries = iterator(
    comp(
      take(pageSize),
      map(({ url }) => articles.getArticle(url)),
    ),
    data,
  );
  const entries = await Promise.all(pagedEntries);
  return rssFeed(feed, entries);
}
