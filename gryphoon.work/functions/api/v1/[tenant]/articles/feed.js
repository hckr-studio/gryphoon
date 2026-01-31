/**
 * @param {EventContext<Env>} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ request, env, params }) {
  const articles = await env.articlesShare.getByName(params.tenant);
  const formData = await request.formData();
  const feed = Object.fromEntries(formData);
  await articles.putFeed(feed);
  return new Response(null, { status: 202 });
}
