export interface Env {
  HOSTNAME: string;
  PRIVATE_KEY: string;
  ROLLBAR_TOKEN: string;
  SEMANTIC_EXTRACTOR_SECRET: string;
  extractor: Service;
  articlesShare: DurableObjectNamespace<ArticlesShare>;
}
