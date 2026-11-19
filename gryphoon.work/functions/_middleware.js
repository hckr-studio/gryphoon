import rollbarPlugin from "@hckr_/cloudflare-pages-plugin-rollbar";
import { getToken, validateToken } from "./lib/auth.js";

const openRoutes = ["/api/v1/:tenant/articles/", "/api/v1/:tenant/articles/beacon"].map(
  pathname => new URLPattern({ pathname }),
);
const authorizedOnly = ["/app/*", "/api/*"].map(pathname => new URLPattern({ pathname }));

const isOpenRoute = url => openRoutes.some(x => x.test(url));
const requiresAuthorization = url => authorizedOnly.some(x => x.test(url));
const isUnauthorizedAccessAllowed = url => isOpenRoute(url) || !requiresAuthorization(url);

/**
 * @param {EventContext<Env>} context
 */
export async function authorization({ request, next, env }) {
  const { url, headers } = request;
  if (isUnauthorizedAccessAllowed(url)) return next();

  const token = getToken(headers);
  const isValidToken = await validateToken(token, env.PRIVATE_KEY);
  console.log("Authorization", url, Boolean(isValidToken));

  if (isValidToken) return next();

  const query = new URLSearchParams({ returnUrl: url });
  return Response.redirect(`https://${env.HOSTNAME}/sign-in/?${query}`, 307);
}

/**
 * @param {EventContext<Env>} context
 * @returns {Promise<Response>}
 */
export async function rollbar(context) {
  return rollbarPlugin({ token: context.env.ROLLBAR_TOKEN })(context);
}

export const onRequest = [rollbar, authorization];
