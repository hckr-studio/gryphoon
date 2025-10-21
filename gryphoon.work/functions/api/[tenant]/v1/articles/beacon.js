/**
 * @param {EventContext<Env>} context
 */
export async function onRequestPost({ request, env, params }) {
  const form = await request.formData();
  const { url, event } = Object.fromEntries(form);
  const articles = await env.articlesShare.getByName(params.tenant);
  const entry = await articles.getArticle(url);
  entry.stats[event] += 1;
  await articles.putArticle(url, entry);
  return new Response(null, { status: 202 });
}
