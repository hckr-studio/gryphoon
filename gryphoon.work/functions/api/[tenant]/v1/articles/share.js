/**
 * @param {EventContext<Env>} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ request, env, params }) {
  const formData = await request.formData();
  const article = Object.fromEntries(formData);

  const articles = await env.articlesShare.getByName(params.tenant);
  const key = article.url;
  const data = await articles.getArticle(key);
  data.entry = Object.assign({
    hostname: new URL(key).hostname,
    published: data.entry?.published ?? new Date().toISOString()
  }, article);
  data.stats = data.stats ?? { clicks: 0, likes: 0 };
  await articles.putArticle(key, data);
  return Response.redirect(new URL("/app/", request.url).href);
}

/**
 * @param {EventContext<Env>} context
 * @returns {Promise<Response>}
 */
export async function onRequestPut({ request, env, params }) {
  const data = await request.json();
  const articles = await env.articlesShare.getByName(params.tenant);
  const key = data.entry.url;
  console.log({ tenant: params.tenant, key, data });
  await articles.putArticle(key, data);
  return new Response();
}
