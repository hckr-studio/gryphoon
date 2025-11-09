/**
 * @param {EventContext<Env>} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet({ request, env, params }) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  const articles = await env.articlesShare.getByName(params.tenant);
  const data = await articles.getArticle(url);
  if (data) return Response.json(data.entry);

  const urlParams = new URLSearchParams({
    tenants: params.tenant,
    url,
    token: env.SEMANTIC_EXTRACTOR_SECRET
  });
  return env.extractor.fetch(`https://gryphoon.work/?${urlParams}`);
}
