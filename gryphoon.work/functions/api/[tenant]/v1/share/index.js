async function updateIndex(store, key, item) {
  const index = await store.get(key);
  const indexByUrl = new Map(index.map(x => [x.url, x]));
  indexByUrl.set(item.url, item);
  const sortedIndex = Array.from(indexByUrl.values()).sort((a, b) => b.published.localeCompare(a.published));
  await store.put(key, JSON.stringify(sortedIndex));
}

/**
 * @param {EventContext<Env>} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ request, env, params }) {
  const formData = await request.formData();
  const article = Object.fromEntries(formData);

  const articles = await env.articlesShare.getByName(params.tenant);
  const data = await articles.getArticle(article.url);
  data.entry = Object.assign({
    hostname: new URL(article.url).hostname,
    published: data.entry?.published ?? new Date().toISOString()
  }, article);
  data.stats = data.stats ?? { clicks: 0, likes: 0 };
  await articles.putArticle(article.url, data);

  await articles.updateIndex({
    url: article.url,
    published: data.entry.published
  });

  const tags = await articles.getTags();
  const tagsSet = new Set(tags);
  const articleTags = article.tags?.split(",")?.map(x => x.trim().toLowerCase()) ?? [];
  await articles.putTags(Array.from(tagsSet.union(new Set(articleTags))).filter(Boolean));
  await Promise.all(articleTags.map(tag => articles.updateIndex(tag, {
    url: article.url,
    published: data.entry.published
  })));

  return Response.redirect(new URL("/app/", request.url).href);
}
