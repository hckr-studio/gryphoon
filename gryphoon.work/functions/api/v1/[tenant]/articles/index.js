import { comp, drop, iterator, map, take } from "@thi.ng/transducers";

/**
 * @param {EventContext<Env>} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet({ env, request, params }) {
  const { searchParams } = new URL(request.url);
  const pageIndex = Math.max(
    0,
    Number.parseInt(searchParams.get("page") ?? "0", 10),
  );
  const pageSize = Math.max(
    0,
    Number.parseInt(searchParams.get("pageSize") ?? "24", 10),
  );
  const tag = searchParams.get("tag");

  const articles = await env.articlesShare.getByName(params.tenant);
  const data = await articles.getIndex(tag);
  const pagedEntries = iterator(
    comp(
      drop(pageIndex * pageSize),
      take(pageSize),
      map(({ url }) => articles.getArticle(url)),
    ),
    data,
  );
  const result = await Promise.all(pagedEntries);
  return Response.json({
    pagination: {
      pageIndex,
      pageSize,
      totalItems: data.length,
      pagesCount: Math.ceil(data.length / pageSize),
    },
    entries: result,
  });
}
