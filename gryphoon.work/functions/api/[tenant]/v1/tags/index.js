/**
 * @param {EventContext<Env>} context
 * @returns {Promise<Response>}
 */
export async function onRequestGet({ env, params }) {
  const articles = await env.articlesShare.getByName(params.tenant);
  const tags = await articles.getTags();
  return Response.json(tags);
}
