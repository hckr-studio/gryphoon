async function updateIndexes(articles, key, entry) {
  await articles.updateIndex({
    url: key,
    published: entry.published
  });

  const tags = await articles.getTags();
  const tagsSet = new Set(tags);
  const articleTags = entry.tags?.split(",")?.map(x => x.trim().toLowerCase()) ?? [];
  await articles.putTags(Array.from(tagsSet.union(new Set(articleTags))).filter(Boolean));
  await Promise.all(articleTags.map(tag => articles.updateIndex(tag, {
    url: key,
    published: entry.published
  })));
}

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
  await updateIndexes(articles, key, data.entry);
  return Response.redirect(new URL("/app/", request.url).href);
}

export async function onRequestPut({ request, env, params }) {
  const data = await request.json();
  const articles = await env.articlesShare.getByName(params.tenant);
  const key = data.entry.url;
  await articles.putArticle(key, data);
  await updateIndexes(articles, key, data.entry);
  return new Response();
}
